export type PrintQuoteInput = {
  volumeCm3: number;
  densityGcm3: number;
  materialPricePerGram: number;
  infillPercent: number;
  qualityMultiplier: number;
  postProcessingPrice?: number;
  quantity?: number;
  minimumOrder?: number;
  setupFee?: number;
  scale?: number;
};

export type PrintQuote = {
  scaledVolumeCm3: number;
  estimatedWeightGrams: number;
  estimatedPrintHours: number;
  materialCost: number;
  processingCost: number;
  unitPrice: number;
  quantity: number;
  total: number;
  isPreliminary: true;
};

export function calculatePrintQuote(input: PrintQuoteInput): PrintQuote {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const scale = Math.max(0.1, input.scale ?? 1);
  const scaledVolumeCm3 = Math.max(0, input.volumeCm3) * scale ** 3;
  const shellFactor = 0.18;
  const infillFactor = Math.max(0.05, Math.min(1, input.infillPercent / 100));
  const effectiveFill = shellFactor + (1 - shellFactor) * infillFactor;
  const estimatedWeightGrams = scaledVolumeCm3 * input.densityGcm3 * effectiveFill;
  const materialCost = estimatedWeightGrams * input.materialPricePerGram;
  const estimatedPrintHours = Math.max(0.25, scaledVolumeCm3 / 12) * input.qualityMultiplier;
  const machineCost = estimatedPrintHours * 120;
  const processingCost = input.postProcessingPrice ?? 0;
  const setupFee = input.setupFee ?? 250;
  const calculatedUnit = (materialCost + machineCost) * input.qualityMultiplier + processingCost + setupFee;
  const minimumOrder = input.minimumOrder ?? 650;
  const unitPrice = Math.ceil(Math.max(minimumOrder, calculatedUnit) / 10) * 10;
  const bulkMultiplier = quantity >= 20 ? 0.82 : quantity >= 10 ? 0.88 : quantity >= 5 ? 0.94 : 1;
  const total = Math.ceil((unitPrice * quantity * bulkMultiplier) / 10) * 10;

  return {
    scaledVolumeCm3: round(scaledVolumeCm3, 3),
    estimatedWeightGrams: round(estimatedWeightGrams, 1),
    estimatedPrintHours: round(estimatedPrintHours, 1),
    materialCost: round(materialCost, 2),
    processingCost: round(processingCost, 2),
    unitPrice,
    quantity,
    total,
    isPreliminary: true,
  };
}

function round(value: number, decimals: number) {
  const power = 10 ** decimals;
  return Math.round(value * power) / power;
}
