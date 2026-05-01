import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export const GROUP_PASSWORD = import.meta.env.VITE_GROUP_PASSWORD
export const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD
