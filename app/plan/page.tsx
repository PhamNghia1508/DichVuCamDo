"use client";
import { useEffect, useState } from "react";
import { Itinerary } from "@/components/Itinerary";
import { TasteMap } from "@/components/TasteMap";
import { Nav, Footer } from "@/components/Chrome";
import { BASE_PATH, decodePlan } from "@/lib/client";
import type { Plan } from "@/lib/types";

export default function SharedPlan() {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  useEffect(() => {
    decodePlan(window.location.hash.slice(1)).then(setPlan);
  }, []);
  return (
    <main>
      <Nav />
      <div className="wrap shared">
        {plan === undefined ? (
          <p className="shared-kicker mono">Opening the plan…</p>
        ) : plan ? (
          <>
            <p className="shared-kicker mono">A plan for {plan.members.join(", ")} · made with TasteCircle</p>
            <Itinerary plan={plan} shared />
            {plan.tasteMap && (
              <div className="shared-map">
                <TasteMap map={plan.tasteMap} plan={plan} />
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            <p className="empty-h">This link lost its plan somewhere in the group chat.</p>
            <p>Links carry the whole plan, so a cut-off paste breaks them. Ask for it again, or make a new one.</p>
            <div className="empty-actions">
              <a className="btn btn-ink btn-sm" href={`${BASE_PATH}/`}>
                Plan a new night <span className="arr" aria-hidden>→</span>
              </a>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
