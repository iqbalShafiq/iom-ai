import type { Database } from "@iom/database";

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: "EMPLOYEE" | "HR_ADMIN";
  sessionId: string;
}

export interface AppBindings {
  Variables: {
    actor: Actor;
    database: Database;
    correlationId: string;
  };
}
