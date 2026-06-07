import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'

export default function Layout() {
  return (
    <div className="flex min-h-full flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-sand-200 bg-sand-100 py-8 text-center">
        <p className="font-display text-xl text-clay-500">Matmatch</p>
        <p className="mt-1 text-xs text-ink-700/60">Vind je yogaleraar in België</p>
      </footer>
    </div>
  )
}
