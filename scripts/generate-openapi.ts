import { writeFile } from "node:fs/promises";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  personSchema,
  dateSchema,
  actionSchema,
  flowerSchema,
} from "../lib/server/core";
import { relationshipSchema } from "../lib/server/network";
const paths: Record<string, any> = {};
function add(
  path: string,
  methods: string[],
  summary: string,
  schema?: string,
) {
  for (const method of methods) {
    const operation: any = {
      summary,
      security: [{ session: [] }],
      responses: {
        "200": { description: "Success" },
        "401": { description: "Authentication required" },
        "404": { description: "Missing or inaccessible record" },
        "409": { description: "Version, uniqueness, or idempotency conflict" },
        "422": { description: "Validation error" },
      },
    };
    if (path.includes("{id}"))
      operation.parameters = [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ];
    if (["post", "patch", "delete"].includes(method))
      operation.parameters = [
        ...(operation.parameters ?? []),
        {
          name: "X-CSRF-Token",
          in: "header",
          required: true,
          schema: { type: "string" },
        },
      ];
    if (schema)
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/" + schema },
          },
        },
      };
    (paths[path] ??= {})[method] = operation;
  }
}
add("/auth/login", ["post"], "Sign in with owner credentials");
paths["/auth/login"].post.security = [];
add("/auth/logout", ["post"], "Revoke the current session");
add("/auth/me", ["get"], "Current owner and CSRF token");
add("/auth/password", ["post"], "Change password and revoke all sessions");
add(
  "/settings",
  ["get", "patch"],
  "Workspace timezone, SMS settings and owner phone",
);
add(
  "/people",
  ["get"],
  "Search and cursor pagination: q, importance, tag, active, cursor, limit",
);
add("/people", ["post"], "Create a person; Idempotency-Key required", "Person");
add("/people/{id}", ["get"], "Person detail");
add("/people/{id}", ["patch"], "Edit person with version", "Person");
for (const suffix of ["archive", "photo"])
  add(
    "/people/{id}/" + suffix,
    ["post"],
    suffix === "photo"
      ? "Upload multipart file: JPEG, PNG or WebP <=5MB"
      : "Archive and stop future work",
  );
add("/people/{id}/photo", ["get"], "Read an owner-scoped private photo");
for (const suffix of ["relationships", "introduction-path", "timeline"])
  add("/people/{id}/" + suffix, ["get"], "Read " + suffix);
add("/tags", ["get", "post"], "List or create expertise and labels");
add("/tags/{id}", ["patch"], "Edit a tag");
add(
  "/relationship-types",
  ["get", "post"],
  "List or create relationship types",
);
add("/relationship-types/{id}", ["patch"], "Edit a relationship type");
add("/relationships", ["get"], "List relationships");
add("/relationships", ["post"], "Create a typed edge", "Relationship");
add(
  "/relationships/{id}",
  ["patch"],
  "Edit an edge with version",
  "Relationship",
);
add("/relationships/{id}", ["delete"], "Archive an edge");
add(
  "/network",
  ["get"],
  "Bounded graph: center_person_id, depth <=2, limit <=200",
);
add("/important-dates", ["get"], "Active occasions, optionally by person_id");
add("/important-dates", ["post"], "Create an occasion", "ImportantDate");
add(
  "/important-dates/{id}",
  ["patch"],
  "Edit an occasion with version",
  "ImportantDate",
);
add(
  "/important-dates/{id}",
  ["delete"],
  "Disable and cancel dependent future work",
);
add(
  "/calendar",
  ["get"],
  "Computed occurrences and actions: from, to ISO days; <=366 days",
);
add(
  "/actions",
  ["get"],
  "Cursor list: status, person_id, due_from, due_to, cursor, limit",
);
add(
  "/actions",
  ["post"],
  "Create action atomically; Idempotency-Key required",
  "Action",
);
add("/actions/{id}", ["get"], "Action, flower details and SMS state");
add("/actions/{id}", ["patch"], "Edit a pending action with version", "Action");
for (const suffix of ["complete", "cancel", "sms-preview", "send-now"])
  add(
    "/actions/{id}/" + suffix,
    ["post"],
    suffix === "send-now"
      ? "Queue an explicit send with preview_token and Idempotency-Key"
      : "Action " + suffix,
  );
add("/interactions", ["post"], "Record a manual, dated interaction");
add(
  "/reminders",
  ["get", "post"],
  "List or create once/per-occurrence reminders",
);
add("/reminders/{id}", ["patch", "delete"], "Edit or disable a reminder");
add("/florists", ["get", "post"], "List or create florists");
add("/florists/{id}", ["patch"], "Edit or deactivate with version");
add("/notifications", ["get"], "Recent notifications");
add("/notifications/{id}/read", ["post"], "Mark read");
add("/dashboard", ["get"], "Owner dashboard; days=1,7,30");
add("/messages", ["get"], "Recent outbound intents");
add("/messages/{id}", ["get"], "Owner-only message payload and attempts");
add(
  "/messages/{id}/reconcile",
  ["post"],
  "Reconcile unknown/accepted provider result",
);
add("/imports/template", ["get"], "Download UTF-8 CSV template");
add(
  "/imports/people",
  ["post"],
  "Stage multipart CSV/XLSX file <=5MB/5000 rows",
);
add("/imports/{id}", ["get"], "Import preview and row decisions");
add(
  "/imports/{id}/mapping",
  ["patch"],
  "Update mapping and explicit row decisions",
);
add("/imports/{id}/validate", ["post"], "Revalidate staging");
add("/imports/{id}/commit", ["post"], "Atomic idempotent commit with checksum");
add("/imports/{id}/errors", ["get"], "Download safe CSV error report");
add(
  "/sms/webhooks/http",
  ["post"],
  "Provider receipt; HMAC SHA256(timestamp + dot + raw body)",
);
paths["/sms/webhooks/http"].post.security = [];
const schemas = Object.fromEntries(
  Object.entries({
    Person: personSchema,
    ImportantDate: dateSchema,
    Action: actionSchema,
    Flower: flowerSchema,
    Relationship: relationshipSchema,
  }).map(([name, schema]) => [
    name,
    zodToJsonSchema(schema, { target: "openApi3" }),
  ]),
);
await writeFile(
  "docs/openapi.json",
  JSON.stringify(
    {
      openapi: "3.0.3",
      info: {
        title: "Relationship OS API",
        version: "1.0.0",
        description:
          "Generated from the implementation schemas and maintained route catalog. All private records are owner scoped. Mutation responses use a shared error envelope.",
      },
      servers: [{ url: "/api/v1" }],
      paths,
      components: {
        securitySchemes: {
          session: {
            type: "apiKey",
            in: "cookie",
            name: "relationship_session",
          },
        },
        schemas,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("Generated docs/openapi.json");
