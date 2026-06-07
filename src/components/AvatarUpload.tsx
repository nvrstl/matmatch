import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Avatar } from './ui'

/**
 * Circular avatar with an upload control. Uploads the chosen image to the
 * `avatars` Storage bucket under `<userId>/…`, then persists the public URL to
 * the teacher's profile and reports it back via onChange.
 */
export default function AvatarUpload({
  userId,
  name,
  photoUrl,
  onChange,
}: {
  userId: string
  name: string
  photoUrl: string | null
  onChange: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Kies een afbeelding.')
    if (file.size > 5 * 1024 * 1024) return setError('Afbeelding mag max. 5 MB zijn.')

    setError(null)
    setBusy(true)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${userId}/${Date.now()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, cacheControl: '3600' })
    if (upErr) {
      setBusy(false)
      return setError(
        upErr.message.includes('Bucket not found')
          ? 'Storage-bucket ontbreekt — voer supabase/storage.sql uit.'
          : upErr.message,
      )
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('teacher_profiles').update({ photo_url: data.publicUrl }).eq('id', userId)
    onChange(data.publicUrl)
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    await supabase.from('teacher_profiles').update({ photo_url: null }).eq('id', userId)
    onChange(null)
    setBusy(false)
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative">
        <Avatar name={name} url={photoUrl} size={112} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Foto uploaden"
          className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-clay-500 text-white shadow-md transition-colors hover:bg-clay-600 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">photo_camera</span>
        </button>
      </div>

      <div className="text-center sm:text-left">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn-secondary"
            disabled={busy}
          >
            {busy ? 'Bezig…' : photoUrl ? 'Foto wijzigen' : 'Foto uploaden'}
          </button>
          {photoUrl && (
            <button
              type="button"
              onClick={remove}
              className="btn-ghost text-rose-600"
              disabled={busy}
            >
              Verwijderen
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-ink-700/50">JPG of PNG · max 5 MB</p>
        {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}
