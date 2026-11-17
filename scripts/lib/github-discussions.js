'use strict';

const { spawnSync } = require('child_process');

const DEFAULT_DISCUSSION_FIRST = 100;
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MAX_COMMENT_PAGES = 100;
const PAGE_INFO_FIELDS = 'pageInfo { hasNextPage endCursor }';
const REPLY_FIELDS = `nodes { authorAssociation } ${PAGE_INFO_FIELDS}`;
const COMMENT_FIELDS = `nodes { id authorAssociation replies(first: 20) { ${REPLY_FIELDS} } } ${PAGE_INFO_FIELDS}`;
const DISCUSSION_ENABLED_QUERY = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { hasDiscussionsEnabled } }';
const DISCUSSION_QUERY = `query($owner: String!, $name: String!, $first: Int!) { repository(owner: $owner, name: $name) { hasDiscussionsEnabled discussions(first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { id number title url updatedAt authorAssociation category { name isAnswerable } answer { url authorAssociation } comments(first: 20) { ${COMMENT_FIELDS} } } } } }`;
const COMMENT_PAGE_QUERY = `query($id: ID!, $after: String!) { node(id: $id) { ... on Discussion { comments(first: 100, after: $after) { ${COMMENT_FIELDS} } } ... on DiscussionComment { replies(first: 100, after: $after) { ${REPLY_FIELDS} } } }`;

function splitRepo(repo) {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo: ${repo}`);
  }
  return { owner, name };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  return result.stdout || '';
}

function runGhJson(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const env = { ...process.env };

  if (!options.useEnvGithubToken) {
    delete env.GITHUB_TOKEN;
  }

  const stdout = runCommand(command, commandArgs, { env });
  try {
    return JSON.parse(stdout || 'null');
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function discussionNeedsMaintainerTouch(discussion) {
  if (MAINTAINER_ASSOCIATIONS.has(discussion.authorAssociation)) {
    return false;
  }

  if (
    discussion.answer
    && MAINTAINER_ASSOCIATIONS.has(discussion.answer.authorAssociation)
  ) {
    return false;
  }

  return !connectionHasMaintainer(discussion.comments);
}

function connectionHasMaintainer(connection) {
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  return nodes.some(comment => MAINTAINER_ASSOCIATIONS.has(comment?.authorAssociation)
    || connectionHasMaintainer(comment?.replies));
}

function readCommentPage(nodeId, cursor, field, options, budget) {
  if (budget.remaining === 0) {
    throw new Error(`Discussion comment pagination exceeded ${MAX_COMMENT_PAGES} additional pages`);
  }
  budget.remaining -= 1;
  const payload = runGhJson([
    'api', 'graphql', '-f', `id=${nodeId}`, '-f', `after=${cursor}`, '-f', `query=${COMMENT_PAGE_QUERY}`,
  ], options);
  const connection = payload?.data?.node?.[field];
  if (payload?.errors?.length || !Array.isArray(connection?.nodes)
    || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
    throw new Error('GitHub discussion comment page is incomplete');
  }
  return connection;
}

function connectionHasMaintainerWithPages(connection, nodeId, field, options, budget) {
  let page = connection;
  const cursors = new Set();
  while (page) {
    // Check everything already visible before requesting any additional page.
    if (connectionHasMaintainer(page)) return true;
    for (const comment of page.nodes || []) {
      if (comment?.replies?.pageInfo?.hasNextPage
        && connectionHasMaintainerWithPages(comment.replies, comment.id, 'replies', options, budget)) return true;
    }
    if (!page.pageInfo?.hasNextPage) return false;
    const cursor = page.pageInfo.endCursor;
    if (typeof nodeId !== 'string' || !nodeId || typeof cursor !== 'string' || !cursor || cursors.has(cursor)) {
      throw new Error('GitHub discussion comment pagination is incomplete or repeated');
    }
    cursors.add(cursor);
    page = readCommentPage(nodeId, cursor, field, options, budget);
  }
  return false;
}

function discussionNeedsAcceptedAnswer(discussion) {
  return Boolean(
    discussion
      && discussion.category
      && discussion.category.isAnswerable
      && !discussion.answer
  );
}

function summarizeDiscussion(discussion) {
  return {
    number: discussion.number,
    title: discussion.title,
    url: discussion.url,
    updatedAt: discussion.updatedAt,
    category: discussion.category ? discussion.category.name : null,
  };
}

function fetchDiscussionSummary(repo, options = {}) {
  const { owner, name } = splitRepo(repo);
  const first = Number.isFinite(options.first) ? options.first : DEFAULT_DISCUSSION_FIRST;
  const enabledPayload = runGhJson([
    'api',
    'graphql',
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-f',
    `query=${DISCUSSION_ENABLED_QUERY}`,
  ], options);
  const enabledRepository = enabledPayload && enabledPayload.data && enabledPayload.data.repository;

  if (!enabledRepository || !enabledRepository.hasDiscussionsEnabled) {
    return emptyDiscussionSummary();
  }

  const payload = runGhJson([
    'api',
    'graphql',
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `first=${first}`,
    '-f',
    `query=${DISCUSSION_QUERY}`,
  ], options);
  const repository = payload && payload.data && payload.data.repository;
  const discussions = repository && repository.discussions;
  const nodes = discussions && Array.isArray(discussions.nodes) ? discussions.nodes : [];
  const budget = { remaining: MAX_COMMENT_PAGES };
  const needingTouch = nodes.filter(discussion => discussionNeedsMaintainerTouch(discussion)
    && !connectionHasMaintainerWithPages(discussion.comments, discussion.id, 'comments', options, budget));
  const missingAcceptedAnswer = nodes.filter(discussionNeedsAcceptedAnswer);

  return {
    enabled: Boolean(repository && repository.hasDiscussionsEnabled),
    totalCount: discussions && Number.isFinite(discussions.totalCount) ? discussions.totalCount : 0,
    sampledCount: nodes.length,
    needingMaintainerTouch: needingTouch.map(summarizeDiscussion),
    answerableWithoutAcceptedAnswer: missingAcceptedAnswer.map(summarizeDiscussion),
  };
}

function emptyDiscussionSummary() {
  return {
    enabled: false,
    totalCount: 0,
    sampledCount: 0,
    needingMaintainerTouch: [],
    answerableWithoutAcceptedAnswer: [],
  };
}

module.exports = {
  DEFAULT_DISCUSSION_FIRST,
  DISCUSSION_ENABLED_QUERY,
  DISCUSSION_QUERY,
  MAINTAINER_ASSOCIATIONS,
  discussionNeedsAcceptedAnswer,
  discussionNeedsMaintainerTouch,
  emptyDiscussionSummary,
  fetchDiscussionSummary,
  splitRepo,
  summarizeDiscussion,
};
