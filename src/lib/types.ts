export type Role = 'teacher' | 'school'

export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

/** A row in `profiles` — one per auth user, holds the role. */
export interface Profile {
  id: string
  role: Role
  full_name: string
  phone: string | null
  created_at: string
}

/** Extra detail for a teacher (role = 'teacher'). */
export interface TeacherProfile {
  id: string // = profiles.id = auth.users.id
  headline: string
  bio: string
  city: string
  styles: string[]
  languages: string[]
  certifications: string | null
  experience_years: number
  hourly_rate: number | null // EUR per session/hour, shown only
  travel_radius_km: number
  photo_url: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}

/** Weekly recurring availability slot for a teacher. */
export interface AvailabilitySlot {
  id: string
  teacher_id: string
  weekday: number // 0 = Sunday … 6 = Saturday
  start_time: string // 'HH:MM'
  end_time: string // 'HH:MM'
}

/** Detail for a school (role = 'school'). */
export interface SchoolProfile {
  id: string // = profiles.id
  name: string
  city: string
  address: string | null
  website: string | null
  about: string | null
  created_at: string
}

/** A booking request from a school to a teacher. */
export interface Booking {
  id: string
  school_id: string
  teacher_id: string
  date: string // 'YYYY-MM-DD'
  start_time: string // 'HH:MM'
  end_time: string // 'HH:MM'
  style: string
  location: string | null
  message: string | null
  proposed_rate: number | null
  status: BookingStatus
  created_at: string
  updated_at: string
}

/** Booking joined with the counterpart's display info, for dashboards. */
export interface BookingWithParties extends Booking {
  school: Pick<SchoolProfile, 'id' | 'name' | 'city'> | null
  teacher: Pick<TeacherProfile, 'id' | 'city'> & { full_name: string } | null
}

/** A teacher card as shown in the browse list (teacher_profile + name). */
export interface TeacherCard extends TeacherProfile {
  full_name: string
}
