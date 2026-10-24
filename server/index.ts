import './env'
import express from 'express'
import { resolve } from 'node:path'
import { api } from './api'

const port = Number(process.env.PORT ?? 5173)
const app = express()
app.use('/api', api)

if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist')
  app.use(express.static(dist))
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

// Bind to localhost only: this serves your personal health data.
app.listen(port, '127.0.0.1', () => {
  console.log(`Lifelong running at http://localhost:${port}`)
  if (!process.env.GARMIN_API_KEY) console.log('No GARMIN_API_KEY in .env yet — run `npm run demo` to explore with sample data.')
})
