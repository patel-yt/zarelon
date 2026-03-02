create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role, referral_code)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case
      when lower(new.email) = 'patshahid23@gmail.com' then 'super_admin'
      else 'user'
    end,
    public.generate_referral_code()
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.users.name, excluded.name),
        role = case
          when lower(excluded.email) = 'patshahid23@gmail.com' then 'super_admin'
          else public.users.role
        end,
        referral_code = coalesce(public.users.referral_code, excluded.referral_code);

  return new;
end;
$$;
