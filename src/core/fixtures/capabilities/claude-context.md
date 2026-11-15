## Context Usage

**Model:** claude-opus-5-5  
**Tokens:** 29.2k / 1m (3%)

### Estimated usage by category

| Category                | Tokens | Percentage |
| ----------------------- | ------ | ---------- |
| System prompt           | 2.5k   | 0.2%       |
| System tools            | 5.9k   | 0.6%       |
| MCP tools               | 612    | 0.1%       |
| MCP server instructions | 2.1k   | 0.2%       |
| MCP tools (deferred)    | 78.4k  | 7.8%       |
| Skills                  | 5.2k   | 0.5%       |
| Messages                | 1.3k   | 0.1%       |
| Free space              | 937.8k | 93.8%      |

### MCP Tools

| Tool                                 | Server                | Tokens |
| ------------------------------------ | --------------------- | ------ |
| mcp__claude_ai_Claude_Docs__batch    | claude_ai_Claude_Docs | 150    |
| mcp__claude_ai_Claude_Docs__create   | claude_ai_Claude_Docs | 233    |
| mcp__claude_ai_Gmail__create_draft   | claude_ai_Gmail       | 2k     |
| mcp__claude_ai_Gmail__delete_draft   | claude_ai_Gmail       | 141    |
| mcp__claude_ai_Gmail__search_threads | claude_ai_Gmail       | 3.9k   |
| mcp__graft__graft_find_code          | graft                 | 420    |
| mcp__graft__graft_repo_map           | graft                 | 380    |

### Skills

| Skill                     | Source               | Tokens |
| ------------------------- | -------------------- | ------ |
| superpowers:brainstorming | Plugin (superpowers) | ~80    |
| superpowers:writing-plans | Plugin (superpowers) | ~40    |
| dataviz                   | Built-in             | ~480   |
| init                      | Built-in             | ~20    |
| docs                      | claude.ai sync       | ~340   |
