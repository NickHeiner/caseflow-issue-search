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
    const graphQlQuery = `
      {
        repository(owner: "department-of-veterans-affairs", name: "caseflow") {
          issues(first: 100, states: CLOSED, before: ${startCursor ? `"${startCursor}"` : null}, orderBy: {
            field: UPDATED_AT
            direction: DESC
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
    `;
    logger.debug({graphQlQuery}, 'Making query');
    const queryResult = await query(graphQlQuery);

    // This may be cutting out a few issues erroneously by stopping a few days early,
    // but overall I think it's close enough.

    const issues = queryResult[0].data.repository.issues.edges;
    const dateCutoff = moment(process.env.DATE_CUTOFF || '2017-01-01');
    const issuesAfterDateCutoff = _.takeWhile(
      issues,
      edge => moment(edge.node.updatedAt).isAfter(dateCutoff)
    );

    const oldestIssueTime = _(issues)
      .map(edge => moment(edge.node.updatedAt).unix())
      .max();

    logger.debug({
      dateCutoff,
      rawIssuesCount: issues.length,
      // eslint-disable-next-line no-magic-numbers
      oldestIssueTime: moment(oldestIssueTime * 1000),
      currentBatchSize: issuesAfterDateCutoff.length
    }, 'Oldest issue time from current batch');

    foundIssues.push(...issuesAfterDateCutoff);

    if (issuesAfterDateCutoff.length < issues.length) {
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

  const getStringSummaryOfIssues = issueUrls => issueUrls.join('\n');

  // eslint-disable-next-line no-console
  console.log(`
Issues Approved by Artem (count: ${issuesPassedPerPerson.artem.count})
${getStringSummaryOfIssues(issuesPassedPerPerson.artem.issues)}
Issues Approved by Alexis (count: ${issuesPassedPerPerson.alexis.count})
${getStringSummaryOfIssues(issuesPassedPerPerson.alexis.issues)}
Issues Approved by neither (count: ${issuesPassedByNoOne.length})
${getStringSummaryOfIssues(issuesPassedByNoOne)}
  `);
})();
