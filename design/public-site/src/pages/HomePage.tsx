import { useEffect } from "react";
import { Hero } from "../components/home/Hero";
import { Statement } from "../components/home/Statement";
import { CycleStory } from "../components/home/CycleStory";
import { Verdict } from "../components/home/Verdict";
import { Ecosystem } from "../components/home/Ecosystem";
import { Rules } from "../components/home/Rules";
import { Knowledge } from "../components/home/Knowledge";
import { FinalCta } from "../components/home/FinalCta";

export function HomePage() {
  useEffect(() => { document.title = "Gymini — Lộ trình tập, huấn luyện viên và phòng gym"; }, []);
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
