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
  const getIssuesForRepo = async repo => {
    const getIssuesUntilTime = async issueQueryFn => {
      const foundIssues = [];
      let startCursor = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const graphQlQuery = `
          {
            repository(owner: "department-of-veterans-affairs", name: "${repo}") {
              ${issueQueryFn(startCursor)}  
            }
          }
        `;
        logger.debug({graphQlQuery}, 'Making query');
        const queryResult = await query(graphQlQuery);
        logger.trace({resultData: queryResult[0].data});

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
      return foundIssues;
    };

    const [validatedIssues, bugReports] = await Promise.all([
      getIssuesUntilTime(startCursor => `
        issues(
          first: 100, states: CLOSED, before: ${startCursor ? `"${startCursor}"` : null}, orderBy: {
            field: UPDATED_AT
            direction: DESC
          }
        ) {
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
      `),
      getIssuesUntilTime(startCursor => `
        issues(
          first: 100, 
          before: ${startCursor ? `"${startCursor}"` : null}, 
          labels: ["bug", "bug-unprioritized", "bug-low-priority", "bug-medium-priority", "bug-high-priority"], 
          orderBy: {field: UPDATED_AT, direction: DESC}
        ) {
          pageInfo {
            startCursor
          }
          edges {
            node {
              updatedAt
              author {
                login
              }
              resourcePath
            }
          }
        }  
      `)
    ]);

    const relevantBugReports = _.filter(
      bugReports, 
      edge => _.includes(['astewarttistatech', 'kierachell'], edge.node.author.login)
    );

    return {
      validatedIssues,
      bugReports: relevantBugReports
    };
  };

  const foundIssues = _.flatten(
    await Promise.all(['caseflow', 'caseflow-efolder'].map(getIssuesForRepo))
  );
  const allValidatedIssues = _(foundIssues).map('validatedIssues').flatten().value();
  const allBugReports = _(foundIssues).map('bugReports').flatten().value();

  logger.info({
    foundIssuesCount: {
      validatedIssues: allValidatedIssues.length,
      bugReports: allBugReports.length
    }, 
    sampleValidatedIssue: allValidatedIssues[0],
    sampleBugReport: allBugReports[0]
  }, 'Got issues');

  const githubUrlOfIssue = issue => `https://github.com${issue.node.resourcePath}`;
  const githubUrlOfIssues = issues => _.map(issues, githubUrlOfIssue);

  const commentsPassedForPerson = login => {
    const issues = _.filter(
      allValidatedIssues, 
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
    alexis: commentsPassedForPerson('astewarttistatech'),
    artem: commentsPassedForPerson('kierachell')
  };

  logger.info({issuesPassedPerPerson});

  const allIssuesPassed = _(issuesPassedPerPerson)
    .values()
    .map('issues')
    .flatten()
    .value();

  const issuesPassedByNoOne = _.difference(githubUrlOfIssues(allValidatedIssues), allIssuesPassed);

  logger.info({
    count: issuesPassedByNoOne.length,
    issues: issuesPassedByNoOne
  }, 'Issues passed by no one');

  const bugReportsForPerson = login => _(allBugReports)
    .filter(edge => edge.node.author.login === login)
    .map(githubUrlOfIssue)
    .value();

  const bugReportsPerPerson = {
    alexis: bugReportsForPerson('astewarttistatech'),
    artem: bugReportsForPerson('kierachell')
  };

  logger.info(bugReportsPerPerson);

  const getStringSummaryOfIssues = issueUrls => issueUrls.join('\n');

  // eslint-disable-next-line no-console
  console.log(`
Issues Approved by Alexis (count: ${issuesPassedPerPerson.alexis.count})
${getStringSummaryOfIssues(issuesPassedPerPerson.alexis.issues)}
Issues Approved by Artem (count: ${issuesPassedPerPerson.artem.count})
${getStringSummaryOfIssues(issuesPassedPerPerson.artem.issues)}
Issues closed without being approved by either (count: ${issuesPassedByNoOne.length})
${getStringSummaryOfIssues(issuesPassedByNoOne)}

Bug Reports from Alexis (count: ${bugReportsPerPerson.alexis.length})
${getStringSummaryOfIssues(bugReportsPerPerson.alexis)}
Bug Reports from Artem (count: ${bugReportsPerPerson.artem.length})
${getStringSummaryOfIssues(bugReportsPerPerson.artem)}
  `);
})();
