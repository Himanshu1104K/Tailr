// Password-protects the dashboard (Basic auth). API routes keep their own secrets (CRON_SECRET, webhook secret).
import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return new NextResponse("Set DASHBOARD_PASSWORD to open the dashboard.", { status: 503 });

  const [scheme, encoded] = (req.headers.get("authorization") ?? "").split(" ");
  let given: string | null = null;
  try {
    if (scheme === "Basic" && encoded) given = atob(encoded).split(":").slice(1).join(":"); // any username
  } catch {} // malformed header → treated as no password
  if (given === password) return NextResponse.next();

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Tailr", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!api/|_next/|icon.svg|favicon.ico).*)"] };
