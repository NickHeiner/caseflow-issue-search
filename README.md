# Caseflow Issue Search

This is a simple script to query GitHub issues, since the UI is not powerful enough.

When making assessments about team velocity, these numbers should be taken with a grain of salt. They cannot tell the whole story without additional context.

I know that many things about this code is sub-optimal, but this is a one-off script that will be run under very specific circumstances, so it's ok.

## Usage
I built this with Node `v8.1.4`.

```
# Ensure that deps are up to date
yarn

# Run the query
DATE_CUTOFF=YYYY-MM-DD ./index.js 
```

Set env var `OPEN` to `true` to open all tickets closed by a QA in the browser.
