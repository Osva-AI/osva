import type { HomePageData } from "../../hooks/use-home-page-data";
import { HomeV2Unavailable } from "./home-v2-unavailable";

export function HomeDegradedPresentation({
  reason,
  data,
}: {
  readonly reason: string;
  readonly data: HomePageData;
}) {
  return (
    <div className="home-v2 home-v2-degraded">
      <HomeV2Unavailable reason={reason} data={data} />
    </div>
  );
}
