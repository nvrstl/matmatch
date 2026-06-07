import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

export default function Landing() {
  const { session, profile } = useAuth()
  const loggedIn = Boolean(session && profile)

  return (
    <div className="-mx-4 -my-8">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            alt="Rustige yogastudio"
            className="h-full w-full object-cover object-center"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuB4mR_yg3CM4vgnJsYLF7IIWODh-qjTUvoAr7s8HFZhQ5hjtFambE9VzMxmHSD3iwPiFEVEDNwUobaNOTf6K28RVclQkcIum9LBQBTmuTU8eVI03wFjnTSuyQWLUr1hT5JDJTLKvg3AZfQJCMk9EAWc2pnWELWhFHSVyt42Jk_k_tqwIBseU7n9mvUMln_fy8pU6y7zKQlpEde51_uvPgy1uM5A6ycIQR6KGoIhyV4ZL18UHjA-0ekhtibjWJVHHY13vq2rSER9YL4"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-sand-50 via-sand-50/70 to-transparent" />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl px-4 py-24 md:px-8 md:py-32">
          <div className="max-w-2xl">
            <span className="mb-4 block text-sm font-semibold uppercase tracking-widest text-clay-500">
              Yoga · België
            </span>
            <h1 className="mb-6 text-4xl leading-tight text-ink-900 md:text-6xl">
              Waar yogascholen <br />
              <span className="italic text-clay-500">leraren vinden.</span>
            </h1>
            <p className="mb-10 max-w-lg text-lg text-ink-700">
              Het platform dat yogaleraren verbindt met scholen. Maak een profiel,
              toon je stijlen en beschikbaarheid, en laat scholen je rechtstreeks
              boeken — of vind in enkele klikken de juiste invaller.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row">
              {loggedIn ? (
                <Link
                  to={profile?.role === 'teacher' ? '/profile' : '/teachers'}
                  className="btn-primary px-8 py-4 text-base"
                >
                  Naar mijn dashboard
                  <Icon name="arrow_forward" className="text-base" />
                </Link>
              ) : (
                <>
                  <Link to="/signup?role=teacher" className="btn-primary px-8 py-4 text-base">
                    Ik ben yogaleraar
                    <Icon name="arrow_forward" className="text-base" />
                  </Link>
                  <Link to="/signup?role=school" className="btn-secondary px-8 py-4 text-base">
                    Ik ben een yogaschool
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mb-14 text-center">
            <span className="mb-3 block text-sm font-semibold uppercase tracking-widest text-clay-500">
              Een digitaal toevluchtsoord
            </span>
            <h2 className="text-3xl text-ink-900 md:text-4xl">Gemaakt voor jouw praktijk.</h2>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            {/* Teachers */}
            <div className="group rounded-2xl border border-sand-200 bg-sand-50 p-8 transition-all duration-500 hover:border-clay-500/30 md:p-12">
              <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-clay-500/10 text-clay-500 transition-all group-hover:bg-clay-500 group-hover:text-white">
                <Icon name="self_improvement" className="text-3xl" />
              </div>
              <h3 className="mb-4 text-2xl text-ink-900">Voor leraren</h3>
              <p className="mb-8 text-ink-700">
                Bouw je agenda op jouw voorwaarden. Kies wanneer, waar en hoe je lesgeeft.
              </p>
              <ul className="space-y-4">
                {[
                  'Maak een profiel met je stijlen, talen en tarief.',
                  'Beheer je wekelijkse beschikbaarheid op één plek.',
                  'Ontvang boekingsaanvragen en accepteer of weiger.',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-ink-900">
                    <Icon name="check_circle" className="mt-0.5 text-clay-500" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Studios */}
            <div className="group rounded-2xl border border-sand-200 bg-sand-50 p-8 transition-all duration-500 hover:border-terra-500/30 md:p-12">
              <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-terra-500/10 text-terra-500 transition-all group-hover:bg-terra-500 group-hover:text-white">
                <Icon name="domain" className="text-3xl" />
              </div>
              <h3 className="mb-4 text-2xl text-ink-900">Voor scholen</h3>
              <p className="mb-8 text-ink-700">
                Houd je rooster gevuld zonder stress bij last-minute uitval. Kwaliteit, vereenvoudigd.
              </p>
              <ul className="space-y-4">
                {[
                  'Zoek leraren op stad, stijl en taal.',
                  'Bekijk profiel, ervaring, talen en tarief.',
                  'Stuur een boekingsaanvraag voor een datum en uur.',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-ink-900">
                    <Icon name="check_circle" className="mt-0.5 text-terra-500" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — bento */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mb-12">
            <h2 className="mb-3 text-3xl text-ink-900 md:text-4xl">Hoe Matmatch werkt</h2>
            <p className="text-lg text-ink-700">Eenvoudige stappen naar je volgende les.</p>
          </div>
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 flex flex-col justify-between rounded-2xl border border-sand-200 bg-sand-100 p-8 md:col-span-8 md:h-72">
              <div>
                <div className="mb-3 text-2xl font-bold text-clay-400">01</div>
                <h4 className="mb-2 text-2xl text-ink-900">Maak je profiel</h4>
                <p className="max-w-md text-ink-700">
                  Leraar of school: toon je stijl en behoeften. Voeg certificaten of
                  studiogegevens toe en je bent klaar.
                </p>
              </div>
              <div className="flex gap-2">
                <span className="chip">Geverifieerd</span>
                <span className="chip">Yogastijlen</span>
              </div>
            </div>
            <div className="col-span-12 flex flex-col justify-center rounded-2xl bg-clay-500 p-8 text-white md:col-span-4 md:h-72">
              <div className="mb-3 text-2xl font-bold text-white/60">02</div>
              <h4 className="mb-2 text-2xl text-white">Plaats &amp; blader</h4>
              <p className="text-white/80">
                Scholen zoeken leraren in seconden. Leraren publiceren hun profiel en
                beschikbaarheid.
              </p>
            </div>
            <div className="col-span-12 flex flex-col justify-between rounded-2xl bg-terra-500 p-8 text-white md:col-span-5 md:h-72">
              <div>
                <div className="mb-3 text-2xl font-bold text-white/60">03</div>
                <h4 className="mb-2 text-2xl text-white">Aanvraag &amp; bevestiging</h4>
                <p className="text-white/80">
                  Een school stuurt een aanvraag voor datum en uur. De leraar accepteert
                  of weigert.
                </p>
              </div>
              <div className="flex justify-end">
                <Icon name="forum" className="text-4xl opacity-50" />
              </div>
            </div>
            <div className="col-span-12 flex items-center gap-8 rounded-2xl border border-sand-200 bg-white p-8 md:col-span-7 md:h-72">
              <div className="flex-1">
                <div className="mb-3 text-2xl font-bold text-ink-700/40">04</div>
                <h4 className="mb-2 text-2xl text-ink-900">Focus op de les</h4>
                <p className="text-ink-700">
                  Beide kanten zien de bevestigde agenda. Het tarief is vooraf duidelijk —
                  geen verrassingen.
                </p>
              </div>
              <div className="hidden h-28 w-28 items-center justify-center rounded-full bg-sand-50 sm:flex">
                <Icon name="event_available" className="text-5xl text-clay-500" />
              </div>
            </div>
          </div>

          {!loggedIn && (
            <div className="mt-12 text-center">
              <Link to="/signup" className="btn-primary px-8 py-4 text-base">
                Begin gratis
                <Icon name="arrow_forward" className="text-base" />
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
