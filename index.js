#! /usr/bin/env node

const logger = require('./logger');
const githubGraphqlClient = require('github-graphql-client');
const _ = require('lodash');
const moment = require('moment');

const queryGithub = options => new Promise((resolve, reject) => {
  githubGraphqlClient(options, (err, ...rest) => {
    if (err) {
      logger.error(err);
      reject(err);
    }
    resolve(rest);
  });
});

const query = graphQl => queryGithub({
  token: process.env.GITHUB_OAUTH_TOKEN,
  query: graphQl
});

(async() => {
  const foundIssues = [];
  let startCursor = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const queryResult = await query(`
      {
        repository(owner: "department-of-veterans-affairs", name: "caseflow") {
          issues(last: 100, states: CLOSED, before: ${startCursor ? `"${startCursor}"` : null} orderBy: {
            field: UPDATED_AT
            direction: ASC
          }) {
            pageInfo {
              startCursor
            }
            edges {
              node {
                updatedAt
                title
                resourcePath
                comments(first: 100) {
                  nodes {
                    bodyText
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    // This may be cutting out a few issues erroneously by stopping a few days early,
    // but overall I think it's close enough.

    const issuesAfterDateCutoff = _.takeWhile(
      queryResult[0].data.repository.issues.edges,
      edge => moment(edge.node.updatedAt).isAfter(moment('2017-05-01'))
    );

    const oldestIssueTime = _(queryResult[0].data.repository.issues.edges)
      .map(edge => moment(edge.node.updatedAt).unix())
      .max();

    logger.debug({
      // eslint-disable-next-line no-magic-numbers
      oldestIssueTime: moment(oldestIssueTime * 1000),
      currentBatchSize: issuesAfterDateCutoff.length
    }, 'Oldest issue time from current batch');

    foundIssues.push(...issuesAfterDateCutoff);

    if (issuesAfterDateCutoff.length < queryResult[0].data.repository.issues.edges.length) {
      break;
    }

    startCursor = queryResult[0].data.repository.issues.pageInfo.startCursor;
    logger.debug({startCursor}, 'Setting start cursor');
  }

  logger.info({foundIssuesCount: foundIssues.length, sampleIssue: foundIssues[0]}, 'Got issues');

  const githubUrlOfIssues = issues => _.map(issues, issue => `https://github.com${issue.node.resourcePath}`);

  const commentsPassedForPerson = login => {
    const issues = _.filter(
      foundIssues, 
      issue => _.some(
        issue.node.comments.nodes, 
        comment => _.includes(comment.bodyText, 'PASSED') && comment.author.login === login
      )
    );
    
    return {
      issues: githubUrlOfIssues(issues),
      count: issues.length
    };
  };

  const issuesPassedPerPerson = {
    artem: commentsPassedForPerson('kierachell'),
    alexis: commentsPassedForPerson('astewarttistatech')
  };

  logger.info({issuesPassedPerPerson});

  const allIssuesPassed = _(issuesPassedPerPerson)
    .values()
    .map('issues')
    .flatten()
    .value();

  const issuesPassedByNoOne = _.difference(githubUrlOfIssues(foundIssues), allIssuesPassed);

  logger.info({
    count: issuesPassedByNoOne.length,
    issues: issuesPassedByNoOne
  }, 'Issues passed by no one');
})();
