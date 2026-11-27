import { Hero } from "../../components/public-site/home/Hero";
import { Statement } from "../../components/public-site/home/Statement";
import { CycleStory } from "../../components/public-site/home/CycleStory";
import { Verdict } from "../../components/public-site/home/Verdict";
import { Ecosystem } from "../../components/public-site/home/Ecosystem";
import { Rules } from "../../components/public-site/home/Rules";
import { Knowledge } from "../../components/public-site/home/Knowledge";
import { usePageMeta } from "../../components/public-site/usePageMeta";
import { FinalCta } from "../../components/public-site/home/FinalCta";

export function HomePage() {
  usePageMeta("Gymini — Lộ trình tập, huấn luyện viên và phòng gym", "Gymini lập lộ trình tập và ăn theo chu kỳ 4 tuần, đánh giá lại bằng số liệu thật, kết nối bạn với huấn luyện viên độc lập và phòng gym đã được thẩm định.");
  return (
    <>
      <Hero />
      <Statement />
      <CycleStory />
      <Verdict />
      <Ecosystem />
      <Rules />
      <Knowledge />
      <FinalCta />
    </>
  );
}
