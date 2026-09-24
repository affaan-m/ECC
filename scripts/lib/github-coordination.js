'use strict';

const policy = require('./github-coordination/policy');
const parsing = require('./github-coordination/parsing');
const ghApi = require('./github-coordination/gh-api');
const state = require('./github-coordination/state');
const actions = require('./github-coordination/actions');
const store = require('./github-coordination/store');

module.exports = {
  DEFAULT_CONFIG_FILE: policy.DEFAULT_CONFIG_FILE,
  DEFAULT_CONFIG_PATH: policy.DEFAULT_CONFIG_PATH,
  DEFAULT_POLICY: policy.DEFAULT_POLICY,
  DEFAULT_SCHEMA_VERSION: policy.DEFAULT_SCHEMA_VERSION,
  loadPolicy: policy.loadPolicy,

  extractCoordinationState: parsing.extractCoordinationState,
  extractIssueReferences: parsing.extractIssueReferences,
  extractTasks: parsing.extractTasks,
  mergeIssueBody: parsing.mergeIssueBody,
  renderCoordinationState: parsing.renderCoordinationState,

  commentIssue: ghApi.commentIssue,
  editIssue: ghApi.editIssue,
  getIssue: ghApi.getIssue,
  listIssues: ghApi.listIssues,
  normalizeIssueNumber: ghApi.normalizeIssueNumber,
  normalizeLabels: ghApi.normalizeLabels,
  normalizeRepo: ghApi.normalizeRepo,
  runGh: ghApi.runGh,
  runGhJson: ghApi.runGhJson,

  buildIssueComment: state.buildIssueComment,
  buildIssueStateFromAction: state.buildIssueStateFromAction,
  defaultCoordinationState: state.defaultCoordinationState,
  desiredLabelsForState: state.desiredLabelsForState,
  getCoordinationState: state.getCoordinationState,
  mapStateToWorkItemStatus: state.mapStateToWorkItemStatus,
  slugifySegment: state.slugifySegment,
  summarizeStateForOutput: state.summarizeStateForOutput,
  syncIssueLabels: state.syncIssueLabels,
  verifyDependenciesClosed: state.verifyDependenciesClosed,

  applyClaim: actions.applyClaim,
  applyDecompose: actions.applyDecompose,
  applyPublish: actions.applyPublish,
  applyReview: actions.applyReview,
  applySync: actions.applySync,
  applyUnblock: actions.applyUnblock,
  applyValidate: actions.applyValidate,
  formatCollection: actions.formatCollection,
  formatSummary: actions.formatSummary,

  epicWorkItemId: store.epicWorkItemId,
  openStore: store.openStore,
  upsertCoordinationWorkItem: store.upsertCoordinationWorkItem,
};
