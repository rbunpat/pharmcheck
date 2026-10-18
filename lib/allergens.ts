/** Preset allergen groups offered in the LIFF picker and test page. */
export const PRESET_ALLERGIES: { name: string; keywords: string[] }[] = [
  { name: "เพนิซิลลิน", keywords: ["penicillin", "amoxicillin", "ampicillin", "cloxacillin", "เพนิซิลลิน"] },
  { name: "ซัลโฟนาไมด์", keywords: ["sulfa", "sulfamethoxazole", "cotrimoxazole", "ซัลฟา"] },
  { name: "NSAIDs / แอสไพริน", keywords: ["aspirin", "ibuprofen", "diclofenac", "naproxen", "nsaid", "แอสไพริน", "ไอบูโพรเฟน"] },
  { name: "พาราเซตามอล", keywords: ["paracetamol", "acetaminophen", "พาราเซตามอล"] },
  { name: "เซฟาลสปอริน", keywords: ["cephalosporin", "cefalexin", "cefixime", "ceftazidime", "เซฟา"] },
  { name: "เตตราไซคลิน", keywords: ["tetracycline", "doxycycline", "เตตราไซคลิน", "ดอกซีไซคลิน"] },
  { name: "ยากลุ่มโอปยอยด์", keywords: ["morphine", "codeine", "tramadol", "โอปยอยด์", "มอร์ฟีน"] },
  { name: "ไอโอดีน / สารทึบรังสี", keywords: ["iodine", "iodide", "ไอโอดีน"] },
];

/**
 * Resolve the keywords for a simulated allergy name: use the preset's full
 * keyword list when the name matches one, otherwise treat the name itself
 * as the only keyword.
 */
export function keywordsForAllergen(name: string): string[] {
  const preset = PRESET_ALLERGIES.find(
    (p) => p.name === name || p.keywords.includes(name),
  );
  return preset ? preset.keywords : [name];
}
