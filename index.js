#! /usr/bin/env node

const logger = require('./logger');
const githubGraphqlClient = require('github-graphql-client');
const _ = require('lodash');

const queryGithub = options => new Promise((resolve, reject) => {
  githubGraphqlClient(options, (err, ...rest) => {
    if (err) {
      reject(err);
    }
    resolve(rest);
  });
});

(async() => {
  const queryResult = await queryGithub({
    token: process.env.GITHUB_OAUTH_TOKEN,
    query: `
      {
        repository(owner: "department-of-veterans-affairs", name: "caseflow") {
          issues(last: 5, states: CLOSED, orderBy: {
            field: UPDATED_AT
            direction: ASC
          }) {
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
    `
  });

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
