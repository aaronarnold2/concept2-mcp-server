# concept2-mcp-server

MCP server for the [Concept2 Logbook API](https://log.concept2.com/developers/documentation/).

## Setup

### 1. Get an Access Token

Use the Concept2 OAuth2 flow to obtain an access token:
- Authorize: `GET https://log.concept2.com/oauth/authorize`
- Token exchange: `POST https://log.concept2.com/oauth/access_token`

Required scopes: `user:read user:write results:read results:write`

### 2. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "concept2": {
      "command": "node",
      "args": ["/path/to/concept2-mcp-server/dist/index.js"],
      "env": {
        "CONCEPT2_ACCESS_TOKEN": "your_access_token_here"
      }
    }
  }
}
```

### 3. Build

```bash
npm install
npm run build
```

## Tools

| Tool | Description |
|------|-------------|
| `concept2_get_user` | Get a user profile ("me" or by ID) |
| `concept2_update_user` | Update the authenticated user's profile |
| `concept2_list_results` | List workout results with pagination and filters |
| `concept2_get_result` | Get a single workout result by ID |
| `concept2_create_result` | Log a new workout result |
| `concept2_create_results_bulk` | Log multiple workouts at once |
| `concept2_update_result` | Update an existing workout result |
| `concept2_delete_result` | Delete a workout result (irreversible) |
| `concept2_get_result_strokes` | Get per-stroke data for a workout |
| `concept2_export_result` | Export a workout as TCX, FIT, or CSV |
| `concept2_list_challenges` | List all Concept2 challenges |
| `concept2_get_current_challenges` | Get currently active challenges |
| `concept2_get_upcoming_challenges` | Get challenges starting within N days |
| `concept2_get_season_challenges` | Get challenges for a specific season year |
| `concept2_get_event_challenges` | Get event challenges for a specific year |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONCEPT2_ACCESS_TOKEN` | Yes | OAuth2 bearer token from Concept2 |
