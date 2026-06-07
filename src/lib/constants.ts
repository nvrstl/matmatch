/** Yoga styles a teacher can offer / a school can request. */
export const YOGA_STYLES = [
  'Hatha',
  'Vinyasa',
  'Yin',
  'Ashtanga',
  'Power yoga',
  'Restorative',
  'Yoga Nidra',
  'Prenatal',
  'Kundalini',
  'Iyengar',
  'Hot yoga',
  'Kinderyoga',
] as const

/** Languages a teacher can give class in. */
export const LANGUAGES = ['Nederlands', 'Frans', 'Engels', 'Duits'] as const

/** Belgian cities (Flanders-first) used for the city picker. */
export const CITIES = [
  'Antwerpen',
  'Gent',
  'Brugge',
  'Leuven',
  'Mechelen',
  'Hasselt',
  'Kortrijk',
  'Aalst',
  'Oostende',
  'Sint-Niklaas',
  'Roeselare',
  'Genk',
  'Brussel',
  'Turnhout',
  'Dendermonde',
] as const

/** Weekday labels, index 0 = zondag (matches JS Date.getDay()). */
export const WEEKDAYS = [
  'Zondag',
  'Maandag',
  'Dinsdag',
  'Woensdag',
  'Donderdag',
  'Vrijdag',
  'Zaterdag',
] as const

/** Short weekday labels for compact display. */
export const WEEKDAYS_SHORT = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'] as const

export const STATUS_LABELS: Record<string, string> = {
  pending: 'In afwachting',
  accepted: 'Bevestigd',
  declined: 'Geweigerd',
  cancelled: 'Geannuleerd',
}

export const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-sand-200 text-ink-700',
}
