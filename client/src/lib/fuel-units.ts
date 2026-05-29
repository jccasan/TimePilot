import { useAddressLabels } from "@/hooks/use-address-labels";

const LITRES_PER_GALLON = 3.785411784;
const L100KM_MPG_CONSTANT = 235.215;

export function galToCentsPerLitre(centsPerGallon: number): number {
  return centsPerGallon / LITRES_PER_GALLON;
}

export function litreToCentsPerGallon(centsPerLitre: number): number {
  return centsPerLitre * LITRES_PER_GALLON;
}

export function mpgToL100km(mpg: number): number {
  if (mpg <= 0) return 0;
  return L100KM_MPG_CONSTANT / mpg;
}

export function l100kmToMpg(l100km: number): number {
  if (l100km <= 0) return 0;
  return L100KM_MPG_CONSTANT / l100km;
}

export function useFuelUnits() {
  const { country } = useAddressLabels();
  const isCanada = country === "ca";

  const gasLabel = isCanada ? "Gas Price (CA$/L)" : "Gas Price ($/gal)";
  const efficiencyLabel = isCanada ? "Vehicle L/100km" : "Vehicle MPG";
  const costPerDistanceLabel = isCanada ? "Cost Per km" : "Cost Per Mile";
  const distanceUnit = isCanada ? "km" : "mi";
  const currencyPrefix = isCanada ? "CA$" : "$";

  function displayGasPrice(centsPerGallon: number): string {
    if (isCanada) {
      return (galToCentsPerLitre(centsPerGallon) / 100).toFixed(2);
    }
    return (centsPerGallon / 100).toFixed(2);
  }

  function displayEfficiency(mpg: number | null | undefined): string {
    if (mpg == null || mpg <= 0) return "";
    if (isCanada) {
      return mpgToL100km(mpg).toFixed(1);
    }
    return String(mpg);
  }

  function parseGasPriceToCentsPerGallon(displayValue: string): number {
    const parsed = parseFloat(displayValue);
    if (isNaN(parsed) || parsed <= 0) return 0;
    if (isCanada) {
      return Math.round(litreToCentsPerGallon(parsed * 100));
    }
    return Math.round(parsed * 100);
  }

  function parseEfficiencyToMpg(displayValue: string): number | null {
    const parsed = parseFloat(displayValue);
    if (isNaN(parsed) || parsed <= 0) return null;
    if (isCanada) {
      return l100kmToMpg(parsed);
    }
    return parsed;
  }

  return {
    isCanada,
    gasLabel,
    efficiencyLabel,
    costPerDistanceLabel,
    distanceUnit,
    currencyPrefix,
    displayGasPrice,
    displayEfficiency,
    parseGasPriceToCentsPerGallon,
    parseEfficiencyToMpg,
  };
}
