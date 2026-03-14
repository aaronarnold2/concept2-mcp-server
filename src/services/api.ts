import axios, { AxiosError } from "axios";
import { API_BASE_URL, API_ACCEPT_HEADER } from "../constants.js";

function getAccessToken(): string {
  const token = process.env.CONCEPT2_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "CONCEPT2_ACCESS_TOKEN environment variable is not set. " +
        "Obtain an access token via OAuth2 and set it in the environment."
    );
  }
  return token;
}

export async function apiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" = "GET",
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  const token = getAccessToken();
  const response = await axios({
    method,
    url: `${API_BASE_URL}${endpoint}`,
    data,
    params,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Accept: API_ACCEPT_HEADER,
      Authorization: `Bearer ${token}`,
    },
  });
  return response.data as T;
}

export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<{ message?: string; errors?: Record<string, string[]> }>;
    if (axiosErr.response) {
      const status = axiosErr.response.status;
      const body = axiosErr.response.data;
      const detail = body?.message ?? "";
      const errors = body?.errors
        ? Object.entries(body.errors)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join("; ")
        : "";
      switch (status) {
        case 400:
          return `Error: Bad request. ${detail}${errors ? ` Errors: ${errors}` : ""}`;
        case 401:
          return "Error: Unauthorized. Check that your CONCEPT2_ACCESS_TOKEN is valid and not expired.";
        case 403:
          return "Error: Forbidden. You do not have permission to access this resource.";
        case 404:
          return "Error: Resource not found. Check that the ID is correct.";
        case 409:
          return `Error: Conflict. ${detail || "The resource already exists or conflicts with existing data."}`;
        case 422:
          return `Error: Validation failed. ${detail}${errors ? ` Errors: ${errors}` : ""}`;
        case 429:
          return "Error: Rate limit exceeded. Please wait before making more requests.";
        case 500:
        case 503:
          return "Error: Concept2 server error. Please try again later.";
        default:
          return `Error: API request failed with status ${status}. ${detail}`;
      }
    } else if (error.code === "ECONNABORTED") {
      return "Error: Request timed out. Please try again.";
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
