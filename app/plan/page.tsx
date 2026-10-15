"use client";
import { useEffect, useState } from "react";
import { Itinerary } from "@/components/Itinerary";
import { Nav, Footer } from "@/components/Chrome";
import { BASE_PATH, decodePlan } from "@/lib/client";
import type { Plan } from "@/lib/types";

export default function SharedPlan() {
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  useEffect(() => {
    setPlan(decodePlan(window.location.hash.slice(1)));
  }, []);
  return (
    <main>
      <Nav />
      <div className="wrap" style={{ paddingBottom: 56, maxWidth: 860 }}>
        {plan === undefined ? null : plan ? (
          <Itinerary plan={plan} shared />
        ) : (
          <div className="empty">
            This share link looks incomplete. <a href={`${BASE_PATH}/`}>Plan a new night →</a>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
