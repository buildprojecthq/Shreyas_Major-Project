-- ========================================================
-- DIGITALIZE RATION: Supabase Schema Migration
-- Updates the 'users' and 'bookings' tables for dynamic quota
-- ========================================================

-- 1. Ensure the 'users' table has the 'family_members' column
ALTER TABLE IF EXISTS public.users 
ADD COLUMN IF NOT EXISTS family_members INTEGER DEFAULT 1 NOT NULL;

-- 2. Backfill existing beneficiaries if any have NULL or 0 family_members
UPDATE public.users 
SET family_members = 1 
WHERE family_members IS NULL OR family_members < 1;

-- 3. Ensure 'bookings' table supports dynamic weight targets for ESP32
ALTER TABLE IF EXISTS public.bookings 
ADD COLUMN IF NOT EXISTS target_grams NUMERIC DEFAULT 100;

-- 4. Ensure Row Level Security (RLS) policies allow app & kiosk operations
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- Allow read access for users/beneficiaries
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Allow public read users'
  ) THEN
    CREATE POLICY "Allow public read users" ON public.users FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Allow public update users'
  ) THEN
    CREATE POLICY "Allow public update users" ON public.users FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Allow public insert users'
  ) THEN
    CREATE POLICY "Allow public insert users" ON public.users FOR INSERT WITH CHECK (true);
  END IF;

  -- Bookings policies (read, insert, update for ESP32 & kiosk)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'Allow public read bookings'
  ) THEN
    CREATE POLICY "Allow public read bookings" ON public.bookings FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'Allow public insert bookings'
  ) THEN
    CREATE POLICY "Allow public insert bookings" ON public.bookings FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'Allow public update bookings'
  ) THEN
    CREATE POLICY "Allow public update bookings" ON public.bookings FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  -- Inventory policies (read and update stock deductions)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'inventory' AND policyname = 'Allow public read inventory'
  ) THEN
    CREATE POLICY "Allow public read inventory" ON public.inventory FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'inventory' AND policyname = 'Allow public update inventory'
  ) THEN
    CREATE POLICY "Allow public update inventory" ON public.inventory FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Auto-compute dynamic target_grams on booking insert from user family_members
CREATE OR REPLACE FUNCTION public.compute_dynamic_booking_target()
RETURNS TRIGGER AS $$
DECLARE
  v_family_members INTEGER;
BEGIN
  SELECT family_members INTO v_family_members
  FROM public.users
  WHERE ration_id = NEW.ration_id;

  IF v_family_members IS NOT NULL AND v_family_members > 1 THEN
    IF NEW.target_grams IS NULL OR NEW.target_grams = 100 THEN
      NEW.target_grams := v_family_members * 100;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_compute_dynamic_booking_target ON public.bookings;
CREATE TRIGGER trigger_compute_dynamic_booking_target
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.compute_dynamic_booking_target();

-- 6. Enable Realtime Replication for instant push to citizen mobile app
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
