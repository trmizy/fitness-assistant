insert into users (id,email,password,role,"updatedAt")
values ('11111111-1111-4111-8111-111111111111','pt.flow.reqinfo@example.com','$2a$10$/h0VX4hlt8V9tZGqoImMBOmZufD.ZMQYl1O8zCF42ibXZRQ6vbNnq','CUSTOMER',now())
on conflict (email) do nothing;

insert into users (id,email,password,role,"updatedAt")
values ('22222222-2222-4222-8222-222222222222','pt.flow.reject@example.com','$2a$10$/h0VX4hlt8V9tZGqoImMBOmZufD.ZMQYl1O8zCF42ibXZRQ6vbNnq','CUSTOMER',now())
on conflict (email) do nothing;

insert into users (id,email,password,role,"updatedAt")
values ('33333333-3333-4333-8333-333333333333','pt.flow.approve@example.com','$2a$10$/h0VX4hlt8V9tZGqoImMBOmZufD.ZMQYl1O8zCF42ibXZRQ6vbNnq','CUSTOMER',now())
on conflict (email) do nothing;
