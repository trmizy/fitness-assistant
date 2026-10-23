import { Redirect } from "expo-router";

/**
 * "Gói dịch vụ" no longer has a screen of its own: packages are part of the trainer's listing and change only
 * through a reviewed revision, so they live in "Tin đăng". This route stays (hidden, see app/pt/_layout.tsx) only so
 * an old deep link or a push that still points at /pt/packages lands on the listing instead of a 404.
 */
export default function PtPackagesRedirect() {
  return <Redirect href={"/pt/listing" as never} />;
}
