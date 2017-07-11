#! /usr/bin/env node

const logger = require('./logger');
const githubGraphqlClient = require('github-graphql-client');

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
      query { 
        repository(owner:"department-of-veterans-affairs", name:"caseflow") {
          issues(last:5, states:CLOSED) {
            edges {
              node {
                comments(last: 1) {
                  nodes {
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

  logger.info({queryResult}, 'got query result');
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
