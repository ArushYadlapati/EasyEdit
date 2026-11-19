import { PLAIN_ERROR } from "@/components/ui/cx";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { readConsentRequest, type ConsentView } from "@/lib/connector/consent";
import { requiredEnv } from "@/lib/env";
import { agentActorId, displayActor } from "@/lib/projects/display-actor";
import { listMySpaces } from "@/lib/spaces/service";
import { canChangeInAnySpace } from "@/lib/spaces/types";
import { ConsentButtons } from "./consent-buttons";

// Where the code goes after Allow. Always said, so a member can tell when it is not where they started.
function destinationLine({ destination }: ConsentView): string {
  switch (destination.kind) {
    case "web":
      return `After you allow, you'll be sent back to ${destination.host}.`;
    case "app":
      return `After you allow, you'll be sent back to the ${destination.name} app.`;
    case "this-computer":
      return `After you allow, you'll be sent back to a program on this computer (port ${destination.port}). Only allow this if you just started connecting from an AI agent on this computer.`;
  }
}

// Who EasyEdit knows the request comes from. A host vouches for a request only when the code goes back to the web: any
// program on the member's computer can use a public metadata document with a loopback address.
function sourceLine({ verifiedHost, nameVerified, destination }: ConsentView): string | null {
  if (verifiedHost !== null) {
    return destination.kind === "this-computer"
      ? `The app's description is published on ${verifiedHost}, but any program on this computer can use it.`
      : `The request comes from ${verifiedHost}.`;
  }
  return nameVerified ? null : "EasyEdit cannot confirm which app this is or who runs it.";
}

// Shown every time an AI agent asks to connect, after the member has signed in.
export default async function ConsentPage({ searchParams }: PageProps<"/consent">) {
  const me = await requireUser();
  const db = getDb();
  const request = await readConsentRequest(db, requiredEnv("BETTER_AUTH_SECRET"), await searchParams);

  if (!request.ok) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="max-w-sm text-center">This request has expired. Go back to your AI agent and connect again.</p>
      </main>
    );
  }

  const { view } = request;
  const { agent, agentName, nameVerified } = view;
  // The name the editor's change list will show, worked out the same way.
  const listedAs = displayActor(agentActorId(agent, me.id), new Map([[me.id, me.name]]));
  const source = sourceLine(view);
  const canChange = canChangeInAnySpace(await listMySpaces(db, me.id));
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          {nameVerified ? `Connect ${agentName}` : "Connect an app"}
        </h1>
        <div className="flex flex-col gap-3 text-sm">
          <p>{`${agentName[0].toUpperCase()}${agentName.slice(1)} is asking to use EasyEdit as you.`}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>It will be able to see the projects in your spaces.</li>
            {canChange ? (
              <li>{`It will be able to create projects and change them. Each change is listed in the editor as “${listedAs}” and can be undone there.`}</li>
            ) : (
              <li>You&apos;re not in a team yet, so it will not be able to change anything.</li>
            )}
          </ul>
          <p>Signed in as {me.email}.</p>
          {source !== null && <p>{source}</p>}
          <p>{destinationLine(view)}</p>
        </div>
        <p className={PLAIN_ERROR}>
          {`Only allow this if you just connected EasyEdit in ${nameVerified ? agentName : "an AI agent"} yourself. If someone sent you a link to this page, choose Don't allow.`}
        </p>
        <ConsentButtons />
      </div>
    </main>
  );
}
