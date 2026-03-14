#!/usr/bin/env node
/**
 * MCP Server for Concept2 Logbook API.
 *
 * Provides tools for interacting with the Concept2 Logbook, including
 * user management, workout results, challenges, and stroke data.
 *
 * Required environment variable:
 *   CONCEPT2_ACCESS_TOKEN - A valid OAuth2 bearer token
 *
 * To obtain a token, use the Concept2 OAuth2 flow:
 *   1. GET https://log.concept2.com/oauth/authorize
 *   2. POST https://log.concept2.com/oauth/access_token
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest, handleApiError } from "./services/api.js";
import { ResponseFormat, type PaginatedResponse, type WorkoutResult, type UserProfile, type Challenge } from "./types.js";
import { CHARACTER_LIMIT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateIfNeeded(text: string, label = "items"): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Use pagination (page, per_page) or filters to narrow results.]`
  );
}

function formatDuration(tenths: number): string {
  const totalSeconds = Math.floor(tenths / 10);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const t = tenths % 10;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

// ─── Shared Zod schemas ──────────────────────────────────────────────────────

const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1).describe("Page number (starting at 1)"),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Results per page (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
});

const UserIdSchema = z
  .union([z.literal("me"), z.number().int().positive()])
  .default("me")
  .describe('User ID or "me" for the authenticated user');

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "concept2-mcp-server",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

server.registerTool(
  "concept2_get_user",
  {
    title: "Get Concept2 User Profile",
    description: `Retrieve a Concept2 Logbook user's profile information.

Use "me" as the user ID to get the authenticated user's own profile.

Returns user details including: id, username, first_name, last_name, gender, dob, age,
weight, location, country, weight_class, max_heart_rate, affiliations, roles.

Args:
  - user_id: User ID (integer) or "me" for the authenticated user (default: "me")
  - response_format: 'markdown' or 'json' (default: 'markdown')

Examples:
  - Get own profile: user_id="me"
  - Get another user: user_id=12345`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ user_id, response_format }) => {
    try {
      const data = await apiRequest<{ data: UserProfile }>(`/users/${user_id}`);
      const user = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(user, null, 2) }] };
      }

      const lines = [
        `# User: ${user.first_name} ${user.last_name} (@${user.username})`,
        `- **ID**: ${user.id}`,
        user.email ? `- **Email**: ${user.email}` : null,
        user.gender ? `- **Gender**: ${user.gender}` : null,
        user.dob ? `- **Date of Birth**: ${user.dob}` : null,
        user.age != null ? `- **Age**: ${user.age}` : null,
        user.weight != null ? `- **Weight**: ${user.weight} kg` : null,
        user.weight_class ? `- **Weight Class**: ${user.weight_class}` : null,
        user.max_heart_rate != null ? `- **Max Heart Rate**: ${user.max_heart_rate} bpm` : null,
        user.location ? `- **Location**: ${user.location}` : null,
        user.country ? `- **Country**: ${user.country}` : null,
        user.affiliations?.length ? `- **Affiliations**: ${user.affiliations.join(", ")}` : null,
        user.roles?.length ? `- **Roles**: ${user.roles.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return { content: [{ type: "text", text: lines }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_update_user",
  {
    title: "Update Concept2 User Profile",
    description: `Update the authenticated user's Concept2 Logbook profile.

Only the authenticated user's own profile can be updated (user_id must be "me" or the authenticated user's ID).

Updatable fields: first_name, last_name, gender, dob, weight, location, country,
weight_class, max_heart_rate.

Args:
  - user_id: User ID or "me" (default: "me")
  - first_name, last_name: Name fields (optional)
  - gender: 'M' or 'F' (optional)
  - dob: Date of birth in YYYY-MM-DD format (optional)
  - weight: Weight in kg (optional)
  - location: City/location string (optional)
  - country: Country code (optional)
  - weight_class: 'H' (heavyweight) or 'L' (lightweight) (optional)
  - max_heart_rate: Maximum heart rate in bpm (optional)

Returns the updated user profile.`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        first_name: z.string().min(1).max(100).optional().describe("First name"),
        last_name: z.string().min(1).max(100).optional().describe("Last name"),
        gender: z.enum(["M", "F"]).optional().describe("Gender: 'M' or 'F'"),
        dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date of birth (YYYY-MM-DD)"),
        weight: z.number().positive().optional().describe("Weight in kg"),
        location: z.string().max(200).optional().describe("Location / city"),
        country: z.string().max(2).optional().describe("Country code (e.g. 'US')"),
        weight_class: z.enum(["H", "L"]).optional().describe("Weight class: 'H' heavyweight or 'L' lightweight"),
        max_heart_rate: z.number().int().min(60).max(250).optional().describe("Maximum heart rate in bpm"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ user_id, response_format, ...fields }) => {
    try {
      const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const data = await apiRequest<{ data: UserProfile }>(`/users/${user_id}`, "PATCH", body);
      const user = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(user, null, 2) }] };
      }

      return {
        content: [
          {
            type: "text",
            text: `# Profile Updated\nUser **${user.first_name} ${user.last_name}** (@${user.username}) has been updated successfully.`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS / WORKOUTS TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

server.registerTool(
  "concept2_list_results",
  {
    title: "List Concept2 Workout Results",
    description: `List workout results (rows/ergs) for a Concept2 Logbook user with pagination and filtering.

Returns a paginated list of workout results. Each result includes: id, date, type,
distance, time, time_formatted, workout_type, weight_class, stroke_rate, avg_pace,
heart_rate, calories, comments.

Args:
  - user_id: User ID or "me" (default: "me")
  - page: Page number (default: 1)
  - per_page: Results per page (default: 50, max: 250)
  - type: Filter by machine type ('rower', 'skierg', 'bikeerg')
  - from: Filter results from this date (YYYY-MM-DD)
  - to: Filter results to this date (YYYY-MM-DD)
  - response_format: 'markdown' or 'json' (default: 'markdown')

Returns pagination metadata: total, count, per_page, current_page, total_pages.

Examples:
  - List all results: user_id="me"
  - List only rowing: user_id="me", type="rower"
  - List results in date range: from="2024-01-01", to="2024-12-31"`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        ...PaginationSchema.shape,
        type: z
          .enum(["rower", "skierg", "bikeerg"])
          .optional()
          .describe("Filter by machine type: 'rower', 'skierg', or 'bikeerg'"),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Start date filter (YYYY-MM-DD)"),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("End date filter (YYYY-MM-DD)"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ user_id, page, per_page, type, from, to, response_format }) => {
    try {
      const params: Record<string, unknown> = { page, per_page };
      if (type) params.type = type;
      if (from) params.from = from;
      if (to) params.to = to;

      const data = await apiRequest<PaginatedResponse<WorkoutResult>>(
        `/users/${user_id}/results`,
        "GET",
        undefined,
        params
      );

      const { data: results, meta } = data;

      if (response_format === ResponseFormat.JSON) {
        const output = {
          results,
          pagination: {
            total: meta.total,
            count: meta.count,
            per_page: meta.per_page,
            current_page: meta.current_page,
            total_pages: meta.total_pages,
            has_more: meta.current_page < meta.total_pages,
          },
        };
        return { content: [{ type: "text", text: truncateIfNeeded(JSON.stringify(output, null, 2)) }] };
      }

      const lines = [
        `# Workout Results (Page ${meta.current_page}/${meta.total_pages})`,
        `**Total**: ${meta.total} results | **Showing**: ${meta.count} per page`,
        "",
      ];

      if (results.length === 0) {
        lines.push("_No results found._");
      } else {
        for (const r of results) {
          const pace = r.avg_500m_pace ? `${formatDuration(r.avg_500m_pace)}/500m` : r.avg_pace ? `${formatDuration(r.avg_pace)}/m` : "—";
          lines.push(
            `## ${r.date} — ${r.type?.toUpperCase() ?? "Unknown"} (ID: ${r.id})`,
            `- **Distance**: ${r.distance}m | **Time**: ${r.time_formatted ?? formatDuration(r.time)} | **Pace**: ${pace}`,
            r.stroke_rate != null ? `- **Stroke Rate**: ${r.stroke_rate} spm` : "",
            r.heart_rate?.average != null ? `- **Avg HR**: ${r.heart_rate.average} bpm` : "",
            r.calories_total != null ? `- **Calories**: ${r.calories_total} kcal` : "",
            r.workout_type ? `- **Workout Type**: ${r.workout_type}` : "",
            r.comments ? `- **Comments**: ${r.comments}` : "",
            ""
          );
        }
        if (meta.current_page < meta.total_pages) {
          lines.push(`_More results available. Use page=${meta.current_page + 1} for the next page._`);
        }
      }

      return { content: [{ type: "text", text: truncateIfNeeded(lines.filter((l) => l !== "").join("\n")) }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_get_result",
  {
    title: "Get Concept2 Workout Result",
    description: `Retrieve a single workout result by ID from the Concept2 Logbook.

Returns full details of a workout including: id, date, type, distance, time,
workout_type, weight_class, stroke_rate, heart_rate, calories_total, drag_factor,
comments, privacy, split_data, and whether stroke data is available.

Args:
  - user_id: User ID or "me" (default: "me")
  - result_id: The workout result ID (integer, required)
  - response_format: 'markdown' or 'json' (default: 'markdown')`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        result_id: z.number().int().positive().describe("Workout result ID"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ user_id, result_id, response_format }) => {
    try {
      const data = await apiRequest<{ data: WorkoutResult }>(`/users/${user_id}/results/${result_id}`);
      const r = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      const pace = r.avg_500m_pace
        ? `${formatDuration(r.avg_500m_pace)}/500m`
        : r.avg_pace
        ? `${formatDuration(r.avg_pace)}/m`
        : "—";

      const lines = [
        `# Workout Result #${r.id}`,
        `- **Date**: ${r.date}${r.timezone ? ` (${r.timezone})` : ""}`,
        `- **Type**: ${r.type?.toUpperCase() ?? "Unknown"}`,
        `- **Distance**: ${r.distance}m`,
        `- **Time**: ${r.time_formatted ?? formatDuration(r.time)}`,
        `- **Avg Pace**: ${pace}`,
        r.workout_type ? `- **Workout Type**: ${r.workout_type}` : null,
        r.weight_class ? `- **Weight Class**: ${r.weight_class}` : null,
        r.stroke_rate != null ? `- **Stroke Rate**: ${r.stroke_rate} spm` : null,
        r.stroke_count != null ? `- **Stroke Count**: ${r.stroke_count}` : null,
        r.drag_factor != null ? `- **Drag Factor**: ${r.drag_factor}` : null,
        r.heart_rate?.average != null
          ? `- **Heart Rate**: avg ${r.heart_rate.average}${r.heart_rate.min != null ? `, min ${r.heart_rate.min}` : ""}${r.heart_rate.max != null ? `, max ${r.heart_rate.max}` : ""} bpm`
          : null,
        r.calories_total != null ? `- **Calories**: ${r.calories_total} kcal` : null,
        r.watts != null ? `- **Watts**: ${r.watts}W` : null,
        r.verified != null ? `- **Verified**: ${r.verified ? "Yes" : "No"}` : null,
        r.privacy ? `- **Privacy**: ${r.privacy}` : null,
        r.comments ? `- **Comments**: ${r.comments}` : null,
        r.stroke_data ? `- **Stroke Data**: Available (use concept2_get_result_strokes to retrieve)` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const splitSection =
        r.split_data && r.split_data.length > 0
          ? "\n\n## Splits\n" +
            r.split_data
              .map(
                (s, i) =>
                  `**Split ${i + 1}**: ${s.distance ?? "—"}m | ${s.time != null ? formatDuration(s.time) : "—"} | ${s.stroke_rate != null ? `${s.stroke_rate} spm` : "—"}`
              )
              .join("\n")
          : "";

      return { content: [{ type: "text", text: lines + splitSection }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_create_result",
  {
    title: "Create Concept2 Workout Result",
    description: `Log a new workout result to the Concept2 Logbook.

Required fields: type, date, distance, time, weight_class.
Optional: timezone, workout_type, stroke_rate, heart_rate, calories_total,
drag_factor, comments, privacy.

Args:
  - user_id: User ID or "me" (default: "me")
  - type: Machine type — 'rower', 'skierg', or 'bikeerg' (required)
  - date: Workout date in YYYY-MM-DD format (required)
  - distance: Distance in meters (required)
  - time: Time in tenths of a second (e.g., 3600 = 6:00.0) (required)
  - weight_class: 'H' (heavyweight) or 'L' (lightweight) (required)
  - timezone: Timezone string (e.g., 'America/New_York') (optional)
  - workout_type: Type of workout (e.g., 'JustRow', 'FixedTimeSplit', 'Intervals') (optional)
  - stroke_rate: Average stroke rate in spm (optional)
  - heart_rate_avg/min/max: Heart rate values in bpm (optional)
  - calories_total: Total calories burned (optional)
  - drag_factor: Machine drag factor (optional)
  - comments: Notes about the workout (optional)
  - privacy: 'private', 'friends', or 'public' (optional)

Returns the created result with its assigned ID.`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        type: z.enum(["rower", "skierg", "bikeerg"]).describe("Machine type"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Workout date (YYYY-MM-DD)"),
        distance: z.number().positive().describe("Distance in meters"),
        time: z
          .number()
          .int()
          .positive()
          .describe("Time in tenths of a second (e.g., 3600 = 6:00.0)"),
        weight_class: z.enum(["H", "L"]).describe("Weight class: 'H' heavyweight or 'L' lightweight"),
        timezone: z.string().optional().describe("Timezone (e.g., 'America/New_York')"),
        workout_type: z
          .string()
          .optional()
          .describe("Workout type (e.g., 'JustRow', 'FixedTimeSplit', 'FixedDistanceSplit', 'Intervals', 'Targets')"),
        stroke_rate: z.number().int().min(1).max(100).optional().describe("Average stroke rate in spm"),
        heart_rate_avg: z.number().int().min(30).max(250).optional().describe("Average heart rate in bpm"),
        heart_rate_min: z.number().int().min(30).max(250).optional().describe("Minimum heart rate in bpm"),
        heart_rate_max: z.number().int().min(30).max(250).optional().describe("Maximum heart rate in bpm"),
        calories_total: z.number().int().positive().optional().describe("Total calories burned"),
        drag_factor: z.number().int().min(1).max(300).optional().describe("Machine drag factor"),
        comments: z.string().max(1000).optional().describe("Workout notes"),
        privacy: z.enum(["private", "friends", "public"]).optional().describe("Result visibility"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({
    user_id,
    response_format,
    heart_rate_avg,
    heart_rate_min,
    heart_rate_max,
    ...fields
  }) => {
    try {
      const body: Record<string, unknown> = { ...fields };
      if (heart_rate_avg != null || heart_rate_min != null || heart_rate_max != null) {
        body.heart_rate = {
          ...(heart_rate_avg != null ? { average: heart_rate_avg } : {}),
          ...(heart_rate_min != null ? { min: heart_rate_min } : {}),
          ...(heart_rate_max != null ? { max: heart_rate_max } : {}),
        };
      }

      const data = await apiRequest<{ data: WorkoutResult }>(`/users/${user_id}/results`, "POST", body);
      const r = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      return {
        content: [
          {
            type: "text",
            text: `# Workout Created (ID: ${r.id})\n- **Date**: ${r.date}\n- **Type**: ${r.type?.toUpperCase()}\n- **Distance**: ${r.distance}m\n- **Time**: ${r.time_formatted ?? formatDuration(r.time)}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_create_results_bulk",
  {
    title: "Bulk Create Concept2 Workout Results",
    description: `Log multiple workout results to the Concept2 Logbook in a single request.

Each result in the array must include the same required fields as concept2_create_result:
type, date, distance, time, weight_class.

Args:
  - user_id: User ID or "me" (default: "me")
  - results: Array of workout objects, each with required fields:
    - type: 'rower', 'skierg', or 'bikeerg'
    - date: YYYY-MM-DD
    - distance: meters (number)
    - time: tenths of a second (integer)
    - weight_class: 'H' or 'L'
    Optional per result: timezone, workout_type, stroke_rate, heart_rate, calories_total,
    drag_factor, comments, privacy.
  - response_format: 'markdown' or 'json'

Returns the created results with their assigned IDs.`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        results: z
          .array(
            z
              .object({
                type: z.enum(["rower", "skierg", "bikeerg"]),
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                distance: z.number().positive(),
                time: z.number().int().positive(),
                weight_class: z.enum(["H", "L"]),
                timezone: z.string().optional(),
                workout_type: z.string().optional(),
                stroke_rate: z.number().int().min(1).max(100).optional(),
                calories_total: z.number().int().positive().optional(),
                drag_factor: z.number().int().min(1).max(300).optional(),
                comments: z.string().max(1000).optional(),
                privacy: z.enum(["private", "friends", "public"]).optional(),
              })
              .strict()
          )
          .min(1)
          .max(100)
          .describe("Array of workout results to create (max 100)"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ user_id, results, response_format }) => {
    try {
      const data = await apiRequest<{ data: WorkoutResult[] }>(
        `/users/${user_id}/results/bulk`,
        "POST",
        results
      );
      const created = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
      }

      const lines = [
        `# Bulk Upload Complete`,
        `**${created.length} workout(s) created successfully.**`,
        "",
        ...created.map(
          (r) =>
            `- ID ${r.id}: ${r.date} | ${r.type?.toUpperCase()} | ${r.distance}m | ${r.time_formatted ?? formatDuration(r.time)}`
        ),
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_update_result",
  {
    title: "Update Concept2 Workout Result",
    description: `Update an existing workout result in the Concept2 Logbook.

Only the result's owner can update it. Provide only the fields you want to change.
Updatable fields: date, distance, time, workout_type, stroke_rate, heart_rate,
calories_total, drag_factor, comments, privacy, weight_class.

Args:
  - user_id: User ID or "me" (default: "me")
  - result_id: The workout result ID to update (required)
  - (Any updatable fields — only provided fields will be changed)
  - response_format: 'markdown' or 'json'`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        result_id: z.number().int().positive().describe("Workout result ID to update"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Workout date (YYYY-MM-DD)"),
        distance: z.number().positive().optional().describe("Distance in meters"),
        time: z.number().int().positive().optional().describe("Time in tenths of a second"),
        weight_class: z.enum(["H", "L"]).optional().describe("Weight class: 'H' or 'L'"),
        workout_type: z.string().optional().describe("Workout type"),
        stroke_rate: z.number().int().min(1).max(100).optional().describe("Average stroke rate in spm"),
        heart_rate_avg: z.number().int().min(30).max(250).optional().describe("Average heart rate in bpm"),
        heart_rate_min: z.number().int().min(30).max(250).optional().describe("Minimum heart rate in bpm"),
        heart_rate_max: z.number().int().min(30).max(250).optional().describe("Maximum heart rate in bpm"),
        calories_total: z.number().int().positive().optional().describe("Total calories burned"),
        drag_factor: z.number().int().min(1).max(300).optional().describe("Machine drag factor"),
        comments: z.string().max(1000).optional().describe("Workout notes"),
        privacy: z.enum(["private", "friends", "public"]).optional().describe("Result visibility"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    user_id,
    result_id,
    response_format,
    heart_rate_avg,
    heart_rate_min,
    heart_rate_max,
    ...fields
  }) => {
    try {
      const body: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined)
      );
      if (heart_rate_avg != null || heart_rate_min != null || heart_rate_max != null) {
        body.heart_rate = {
          ...(heart_rate_avg != null ? { average: heart_rate_avg } : {}),
          ...(heart_rate_min != null ? { min: heart_rate_min } : {}),
          ...(heart_rate_max != null ? { max: heart_rate_max } : {}),
        };
      }

      const data = await apiRequest<{ data: WorkoutResult }>(
        `/users/${user_id}/results/${result_id}`,
        "PATCH",
        body
      );
      const r = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      return {
        content: [
          {
            type: "text",
            text: `# Result #${r.id} Updated\n- **Date**: ${r.date}\n- **Distance**: ${r.distance}m\n- **Time**: ${r.time_formatted ?? formatDuration(r.time)}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_get_result_strokes",
  {
    title: "Get Concept2 Workout Stroke Data",
    description: `Retrieve per-stroke data for a specific workout result from the Concept2 Logbook.

Stroke data is only available if the workout was recorded with stroke tracking enabled
(check the 'stroke_data' field on the result). Returns an array of stroke objects
with per-stroke metrics.

Each stroke object may include: ts (timestamp), d (distance), p (pace in ms/500m),
spm (stroke rate), hr (heart rate).

Args:
  - user_id: User ID or "me" (default: "me")
  - result_id: The workout result ID (required)
  - response_format: 'markdown' or 'json' (default: 'json' — stroke data is typically large)`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        result_id: z.number().int().positive().describe("Workout result ID"),
        response_format: z
          .nativeEnum(ResponseFormat)
          .default(ResponseFormat.JSON)
          .describe("Output format (default: 'json' for stroke data)"),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ user_id, result_id, response_format }) => {
    try {
      const data = await apiRequest<{ data: unknown[] }>(
        `/users/${user_id}/results/${result_id}/strokes`
      );
      const strokes = data.data;

      if (response_format === ResponseFormat.JSON) {
        return {
          content: [
            {
              type: "text",
              text: truncateIfNeeded(JSON.stringify({ stroke_count: strokes.length, strokes }, null, 2), "strokes"),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: truncateIfNeeded(
              `# Stroke Data for Result #${result_id}\n**Total Strokes**: ${strokes.length}\n\n` +
                JSON.stringify(strokes, null, 2),
              "strokes"
            ),
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_export_result",
  {
    title: "Export Concept2 Workout Result",
    description: `Export a workout result in a specific format from the Concept2 Logbook.

Available export types vary by workout but typically include: 'tcx', 'fit', 'csv'.

Args:
  - user_id: User ID or "me" (default: "me")
  - result_id: The workout result ID (required)
  - export_type: Export format — 'tcx', 'fit', or 'csv' (required)

Returns the raw export file content as text.`,
    inputSchema: z
      .object({
        user_id: UserIdSchema,
        result_id: z.number().int().positive().describe("Workout result ID"),
        export_type: z
          .enum(["tcx", "fit", "csv"])
          .describe("Export format: 'tcx', 'fit', or 'csv'"),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ user_id, result_id, export_type }) => {
    try {
      const data = await apiRequest<string>(
        `/users/${user_id}/results/${result_id}/export/${export_type}`
      );
      const text = typeof data === "string" ? data : JSON.stringify(data);
      return { content: [{ type: "text", text: truncateIfNeeded(text) }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHALLENGES TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

function formatChallengeMarkdown(c: Challenge): string {
  const lines = [
    `## ${c.name} (ID: ${c.id})`,
    c.type ? `- **Type**: ${c.type}` : null,
    c.status ? `- **Status**: ${c.status}` : null,
    c.start_date ? `- **Start**: ${c.start_date}` : null,
    c.end_date ? `- **End**: ${c.end_date}` : null,
    c.distance != null ? `- **Distance**: ${c.distance}m` : null,
    c.time != null ? `- **Time**: ${formatDuration(c.time)}` : null,
    c.description ? `- **Description**: ${c.description}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

server.registerTool(
  "concept2_list_challenges",
  {
    title: "List Concept2 Challenges",
    description: `List all available Concept2 challenges (all time).

Returns a list of challenges including: id, name, type, status, start_date,
end_date, distance, time, description.

Args:
  - response_format: 'markdown' or 'json' (default: 'markdown')`,
    inputSchema: z
      .object({
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ response_format }) => {
    try {
      const data = await apiRequest<{ data: Challenge[] }>("/challenges");
      const challenges = data.data;

      if (response_format === ResponseFormat.JSON) {
        return {
          content: [
            { type: "text", text: truncateIfNeeded(JSON.stringify(challenges, null, 2)) },
          ],
        };
      }

      const text =
        `# Concept2 Challenges (${challenges.length} total)\n\n` +
        challenges.map(formatChallengeMarkdown).join("\n\n");

      return { content: [{ type: "text", text: truncateIfNeeded(text) }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_get_current_challenges",
  {
    title: "Get Current Concept2 Challenges",
    description: `Retrieve currently active Concept2 challenges.

Returns challenges that are currently running, including their details:
id, name, type, start_date, end_date, distance, time, description.

Args:
  - response_format: 'markdown' or 'json' (default: 'markdown')`,
    inputSchema: z
      .object({
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ response_format }) => {
    try {
      const data = await apiRequest<{ data: Challenge[] }>("/challenges/current");
      const challenges = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(challenges, null, 2) }] };
      }

      if (challenges.length === 0) {
        return { content: [{ type: "text", text: "No challenges are currently active." }] };
      }

      const text =
        `# Current Active Challenges (${challenges.length})\n\n` +
        challenges.map(formatChallengeMarkdown).join("\n\n");

      return { content: [{ type: "text", text: text }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_get_upcoming_challenges",
  {
    title: "Get Upcoming Concept2 Challenges",
    description: `Retrieve upcoming Concept2 challenges starting within a given number of days.

Args:
  - days: Number of days ahead to look for upcoming challenges (default: 30, max: 365)
  - response_format: 'markdown' or 'json' (default: 'markdown')`,
    inputSchema: z
      .object({
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe("Number of days ahead to look for upcoming challenges"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ days, response_format }) => {
    try {
      const data = await apiRequest<{ data: Challenge[] }>(`/challenges/upcoming/${days}`);
      const challenges = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(challenges, null, 2) }] };
      }

      if (challenges.length === 0) {
        return {
          content: [{ type: "text", text: `No challenges starting in the next ${days} days.` }],
        };
      }

      const text =
        `# Upcoming Challenges (next ${days} days, ${challenges.length} total)\n\n` +
        challenges.map(formatChallengeMarkdown).join("\n\n");

      return { content: [{ type: "text", text: text }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_get_season_challenges",
  {
    title: "Get Concept2 Season Challenges",
    description: `Retrieve Concept2 challenges for a specific season/year.

Args:
  - year: The season year (e.g., 2024) (required)
  - response_format: 'markdown' or 'json' (default: 'markdown')`,
    inputSchema: z
      .object({
        year: z
          .number()
          .int()
          .min(2010)
          .max(2100)
          .describe("Season year (e.g., 2024)"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ year, response_format }) => {
    try {
      const data = await apiRequest<{ data: Challenge[] }>(`/challenges/season/${year}`);
      const challenges = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(challenges, null, 2) }] };
      }

      if (challenges.length === 0) {
        return { content: [{ type: "text", text: `No challenges found for the ${year} season.` }] };
      }

      const text =
        `# ${year} Season Challenges (${challenges.length} total)\n\n` +
        challenges.map(formatChallengeMarkdown).join("\n\n");

      return { content: [{ type: "text", text: text }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

server.registerTool(
  "concept2_get_event_challenges",
  {
    title: "Get Concept2 Event Challenges",
    description: `Retrieve Concept2 event challenges for a specific year.

Event challenges are typically tied to specific Concept2 events and competitions.

Args:
  - year: The year to retrieve event challenges for (e.g., 2024) (required)
  - response_format: 'markdown' or 'json' (default: 'markdown')`,
    inputSchema: z
      .object({
        year: z
          .number()
          .int()
          .min(2010)
          .max(2100)
          .describe("Year (e.g., 2024)"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ year, response_format }) => {
    try {
      const data = await apiRequest<{ data: Challenge[] }>(`/challenges/events/${year}`);
      const challenges = data.data;

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(challenges, null, 2) }] };
      }

      if (challenges.length === 0) {
        return { content: [{ type: "text", text: `No event challenges found for ${year}.` }] };
      }

      const text =
        `# ${year} Event Challenges (${challenges.length} total)\n\n` +
        challenges.map(formatChallengeMarkdown).join("\n\n");

      return { content: [{ type: "text", text: text }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleApiError(error) }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  if (!process.env.CONCEPT2_ACCESS_TOKEN) {
    console.error(
      "ERROR: CONCEPT2_ACCESS_TOKEN environment variable is required.\n" +
        "Obtain an OAuth2 access token from https://log.concept2.com/oauth/authorize\n" +
        "and set it: export CONCEPT2_ACCESS_TOKEN=your_token_here"
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Concept2 MCP server running via stdio");
}

main().catch((error: unknown) => {
  console.error("Server error:", error);
  process.exit(1);
});
