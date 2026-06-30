-- Migration 006: rename "David Owen Suite" to "Owen Suite" in all tables

UPDATE public.bookings
   SET room = 'Owen Suite'
 WHERE room = 'David Owen Suite';

UPDATE public.booking_changes
   SET old_room = 'Owen Suite'
 WHERE old_room = 'David Owen Suite';

UPDATE public.booking_changes
   SET new_room = 'Owen Suite'
 WHERE new_room = 'David Owen Suite';
