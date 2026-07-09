/**
 * Free-trial / non-paying businesses — excluded from Health Monitor and Daily Session features.
 * Source of truth: csv/Client and business v2.xlsx
 * Any business running sessions that does NOT appear in v2 is treated as free trial.
 * Last synced: 2026-06-29
 */
export const FREE_TRIAL_BUSINESSES = new Set([
  // ── Confirmed free trials (appeared in CSVs, not in v2 xlsx) ──────────────
  "Audra Sanderhoff",
  "LAKE TAHOE BOAT TOURS",
  "Red River Revel",
  "WEBSITE",

  // ── Historical free trials (ran earlier sessions, now inactive) ───────────
  "A Silent Moment Spa Organic",
  "Acosta-s-Concrete-Construction",
  "Agreenercleanerutah",
  "Air Duct Cleaning",
  "Amazon Operations Center of Excellence",
  "Another Locksmith in Twin Cities Metro",
  "Anthony's Painting and Remodeling",
  "Arizona Palms Tinting",
  "Ask Your Travel Agent Ltd.",
  "Awaken Within Healing",
  "Beverly Hills Real Estate",
  "Bleu Acier Inc.",
  "Bowling Alley, Arcade, Birthday Parties",
  "Bradchism",
  "Brandy Medlock",
  "Call It Closed Int'l. Realty | Marti Davis | Realtor & Senior Placement Advocate",
  "Camgirls Plus",
  "Capitol Information Affiliates",
  "Castle Bookkeeping",
  "Central Coast Landmark Properties",
  "Chimney Sweep, Chimney Cleaning, Vancouver WA",
  "Codex Free Trial API Test - Ignore 20260605-113030",
  "Creative Painters 39 yrs in Business",
  "Custom Holiday Lighting",
  "DaVisse Micro Art PMU / Rhonda Winters",
  "Denise Osewalt",
  "Diamond Source NYC",
  "DJ Splash",
  "Dog Training/The Pooch Pros/ San Angelo",
  "Dr. Quick Books, Inc.",
  "Elite Training Solutions NJ",
  "Encap Carpet Cleaning Products",
  "Energywize Air Conditioning & Refrigeration",
  "Gallery",
  "Gourmet Landscape and Lawn Care LLC",
  "Grossman Inc.",
  "Home-final",
  "Hrem",
  "Indianapolis Wedding DJ",
  "Inlet Crossing Chiropractic",
  "Insuredbyrich.com",
  "J. Vanover and Co.",
  "James Hall Fireworks",
  "Jenhaug",
  "Jensen Movers & Storage, Inc",
  "Joeselzfla",
  "Julia's Deliciousness",
  "Kelly Automatic Gate Service",
  "Labavetta Inc",
  "Lakeland Flowers",
  "Legendary Landscape Construction, Inc.",
  "Life Coach Cynthia Benedict Counselor and Life Coach",
  "Majestic Sugaring Studio",
  "Mark mckay painting services",
  "Mcguire Welding",
  "Michael David F Aromatherapy Guild of Pepperers",
  "Miller and Sons Plumbing",
  "Mobile IV Therapy in Austin",
  "Myers Team Realty",
  "Naturally Me Hair Care",
  "New York City Photographer",
  "Nutydes",
  "Ocean View Massage and Spa",
  "Official Site of Latina Model Magazine",
  "ONTIME HEATING AND COOLING",
  "Paperproducts Design US Inc",
  "Party Tyme Entertainment",
  "Photo Booth Cafe",
  "Renees Resales",
  "Reset Aesthetics + Ethereal Wellness",
  "Revivify Aesthetics",
  "Rick's Carpet Cleaning",
  "Safeguardhome Inspector",
  "Seattle, WA Boudoir & Portrait Photography",
  "Seed Of Kindness, LLC",
  "Seven Seas and Suitcases LLC",
  "horeline Trees LLC",
  "Skin Secrets",
  "Stephen Mattner Painting",
  "Tahoe Blue Association Management",
  "The Bodyshoptn",
  "The Boston Deli",
  "The Mitchdennis Agency",
  "The Sisters' Beauty Bar And Cosmetic Tattoo",
  "Thrilling Adventures",
  "Trader Ed's Restaurant",
  "Transitionsliaisonglobal",
  "VMS Construction",
  "Wichita Florist",
  "Window Washing and Gutter Cleaning",
  "Zeller Real Estate",
]);

/** Case-insensitive check — handles minor capitalisation differences. */
export function isFreeTrial(businessName: string): boolean {
  const name = businessName.trim();
  if (FREE_TRIAL_BUSINESSES.has(name)) return true;
  const lower = name.toLowerCase();
  for (const ft of FREE_TRIAL_BUSINESSES) {
    if (ft.toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Strip free-trial entries from a list of objects that carry a business name.
 * Accepts common field names used across the API responses.
 */
export function filterOutFreeTrials<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.filter(item => {
    const name = String(
      item.business_name ?? item.biz_name ?? item.name ?? ""
    );
    return !isFreeTrial(name);
  });
}

/**
 * Paying client businesses in v2 xlsx that have NO sessions yet in the CSV data.
 * These should be flagged in Health Monitor as "not started" rather than "at risk".
 */
export const NO_SESSIONS_YET = new Set([
  "Compass Flats",
  "Gruene Pointe Apartments",
  "GYMGUYZ San Francisco & Marin, CA",
  "Mighty Dog Roofing of Rhode Island, East Greenwich",
  "Shield Rodent Proofing",
  "The Fusion at RYE 3030",
  "The Passages at Rye 1255",
  "The Reserve at Rye 290",
  "Vivo Living Willowbrook",
  "Wilnez Home Improvement LLC",
]);

export function isNotStarted(businessName: string): boolean {
  const name = businessName.trim();
  if (NO_SESSIONS_YET.has(name)) return true;
  const lower = name.toLowerCase();
  for (const b of NO_SESSIONS_YET) {
    if (b.toLowerCase() === lower) return true;
  }
  return false;
}
