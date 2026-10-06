# @alltherepos/mcp

MCP server for the AllTheRepos catalog. Lets a Claude Code session read
your repositories and record how they relate to one another.

## Why

The relationship map derives edges from what it can read on disk —
shared dependencies, README links, remote owner, name families. That
misses intent. A repo is "part of The-Hive" because of a decision
someone made, and no file records it. This server gives a session
somewhere to put what it works out.

## Install

```sh
cd mcp && npm install && npm run build
claude mcp add alltherepos -- node /absolute/path/to/mcp/dist/index.js
```

Set `ATR_DATA_DIR` to override the catalog location; it defaults to
`~/Library/Application Support/alltherepos`.

## Tools

| Tool         | Purpose                               |
| ------------ | ------------------------------------- |
| `find_repos` | Search the catalog                    |
| `get_repo`   | One repository plus its relationships |
| `get_map`    | Clusters, folder spread, strays       |
| `link`       | Assert a relationship                 |
| `unlink`     | Remove an asserted relationship       |
| `list_links` | Read asserted relationships           |

## What it cannot do

It writes to exactly one table, `repo_links`. It cannot move a
repository, create or rename a folder, run a project task, kill a
process, fetch, pull, or open anything. Those stay in the desktop app
behind their preflight rails. See `../docs/COMMAND-DISCLOSURE.md`.
