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

    const issuesAfterDateCutoff = _.takeWhile(
      queryResult[0].data.repository.issues.edges,
      edge => moment(edge.node.updatedAt).isAfter(moment('2017-05-01'))
    );

    foundIssues.push(...issuesAfterDateCutoff);

    if (issuesAfterDateCutoff.length < queryResult[0].data.repository.issues.edges.length) {
      break;
    }

    startCursor = queryResult[0].data.repository.issues.pageInfo.startCursor;
    logger.info({startCursor}, 'Setting start cursor');
  }

  logger.info({foundIssuesCount: foundIssues.length}, 'Got issues');

  const commentsPassedForPerson = login => {
    const issues = _.filter(
      queryResult[0].data.repository.issues.edges, 
      issueNode => _.some(
        issueNode.node.comments.nodes, 
        comment => _.includes(comment.bodyText, 'PASSED') && comment.author.login === login
      )
    );
    
    return {
      issues: _.map(issues, issueNode => `https://github.com/${issueNode.node.resourcePath}`),
      count: issues.length
    };
  };

  const issuesPassedPerPerson = {
    artem: commentsPassedForPerson('kierachell'),
    alexis: commentsPassedForPerson('astewarttistatech')
  };

  logger.info({issuesPassedPerPerson});
})();

/*
{
  repository(owner: "department-of-veterans-affairs", name: "caseflow") {
    issues(last: 5, states: CLOSED) {
      edges {
        node {
          title
          timeline(last: 2) {
            edges {
              node {
                ... on ClosedEvent {
                  actor {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
*/

/*
{
  repository(owner: "department-of-veterans-affairs", name: "caseflow") {
    issues(last: 5, states: CLOSED, orderBy: {
      field: UPDATED_AT,
      direction: ASC
    }) {
      edges {
        node {
          title
          resourcePath
          timeline(last: 2) {
            edges {
              node {
                ... on ClosedEvent {
                  actor {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
*/
