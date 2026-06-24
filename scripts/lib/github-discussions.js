'use strict';

const { spawnSync } = require('child_process');

const DEFAULT_DISCUSSION_FIRST = 100;
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const DISCUSSION_ENABLED_QUERY = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { hasDiscussionsEnabled } }';
const DISCUSSION_QUERY = 'query($owner: String!, $name: String!, $first: Int!) { repository(owner: $owner, name: $name) { hasDiscussionsEnabled discussions(first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { number title url updatedAt authorAssociation category { name isAnswerable } answer { url authorAssociation } comments(first: 20) { nodes { authorAssociation } } } } } }';

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

  const comments = discussion.comments && Array.isArray(discussion.comments.nodes)
    ? discussion.comments.nodes
    : [];
  return !comments.some(comment => MAINTAINER_ASSOCIATIONS.has(comment.authorAssociation));
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
  const needingTouch = nodes.filter(discussionNeedsMaintainerTouch);
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
