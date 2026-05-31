
-- Re-seed Huy Trong
INSERT INTO user_profiles (id, "userId", "firstName", "lastName", email, "isPT", session_duration_minutes, "createdAt", "updatedAt") VALUES 
('profile_huy_trong', 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'Huy', 'Trong', 'huytronh1@gmail.com', true, 60, now(), now());

INSERT INTO pt_applications (id, user_profile_id, status, phone_number, sessions_per_package, package_price, session_duration_minutes, availability_blocks, approved_at, created_at, updated_at) VALUES 
('app_huy_trong', 'profile_huy_trong', 'APPROVED', '0901234567', 10, 5000, 60, '[{"dayOfWeek":"MONDAY","startTime":"08:00","endTime":"11:00"},{"dayOfWeek":"MONDAY","startTime":"14:00","endTime":"18:00"},{"dayOfWeek":"WEDNESDAY","startTime":"08:00","endTime":"11:00"},{"dayOfWeek":"WEDNESDAY","startTime":"14:00","endTime":"18:00"},{"dayOfWeek":"FRIDAY","startTime":"08:00","endTime":"11:00"},{"dayOfWeek":"FRIDAY","startTime":"14:00","endTime":"18:00"}]', now(), now(), now());

INSERT INTO pt_availability (id, pt_user_id, day_of_week, start_time, end_time, is_active, created_at, updated_at) VALUES 
(gen_random_uuid(), 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'MONDAY', '08:00', '11:00', true, now(), now()),
(gen_random_uuid(), 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'MONDAY', '14:00', '18:00', true, now(), now()),
(gen_random_uuid(), 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'WEDNESDAY', '08:00', '11:00', true, now(), now()),
(gen_random_uuid(), 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'WEDNESDAY', '14:00', '18:00', true, now(), now()),
(gen_random_uuid(), 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'FRIDAY', '08:00', '11:00', true, now(), now()),
(gen_random_uuid(), 'c507d33e-2b34-4b14-9423-2ad5ec08a691', 'FRIDAY', '14:00', '18:00', true, now(), now());
