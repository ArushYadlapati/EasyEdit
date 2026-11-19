import { AppNotFound } from "@/components/dashboard/app-not-found";

// A dashboard page that calls notFound() (a space that doesn't exist or that this person isn't in, a space's settings,
// Learn on a server without the tutorial's video) shows this under the dashboard's own header, which the layout has
// already drawn for this signed-in person. Addresses that match no page at all get the public 404 (app/not-found.tsx).
export default function DashboardNotFound() {
  return <AppNotFound />;
}
