// NotFound: the catch-all route ("*" in src/App.tsx).
//
// Deliberately tiny. It reuses PageHeader and Button so a mistyped URL still
// looks like part of the same production.

import { Link } from "react-router";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl py-10 text-center">
      <PageHeader
        eyebrow="404"
        title="Cut from the final edit"
        lede="That page never made it past the screening. The ballot, the leaderboard and the archive are all still open."
      />
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/">
          <Button>Back to the lobby</Button>
        </Link>
        <Link to="/browse">
          <Button variant="secondary">Browse the archive</Button>
        </Link>
      </div>
    </div>
  );
}
