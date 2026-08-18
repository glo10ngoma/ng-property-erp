import { BadRequestException } from '@nestjs/common';
import type { SimulateSalesSubscriptionDto } from './dto';
import type { SalesSettings, SalesSubscriptionInstallment, SalesSubscriptionSimulation } from './types';

type NormalizedSimulation = {
  summary: SalesSubscriptionSimulation['summary'];
  installments: SalesSubscriptionInstallment[];
  derived: {
    final_sale_price: number;
    discount_amount: number;
    deposit_amount: number;
    deposit_percentage: number | null;
    financed_balance: number;
    installment_count: number;
    frequency: string;
    first_due_date: string | null;
    grace_period_days: number;
    regular_installment_amount: number;
    final_installment_amount: number | null;
  };
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} doit être au format YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label} est invalide.`);
  }
  return date;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addMonths(source: Date, months: number) {
  const date = new Date(source.getTime());
  const originalDay = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date;
}

function defaultFirstDueDate(gracePeriodDays: number) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() + Math.max(0, gracePeriodDays));
  return formatDate(now);
}

function asNumber(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function simulateSalesSubscriptionPlan(
  dto: SimulateSalesSubscriptionDto,
  settings: SalesSettings | null,
): NormalizedSimulation {
  const catalogPrice = roundMoney(asNumber(dto.catalog_price));
  const negotiatedPrice = dto.negotiated_price != null ? roundMoney(asNumber(dto.negotiated_price)) : null;
  const explicitDiscount = dto.discount_amount != null ? roundMoney(asNumber(dto.discount_amount)) : null;

  if (catalogPrice < 0) {
    throw new BadRequestException('Le prix catalogue doit être positif.');
  }

  let finalSalePrice = negotiatedPrice ?? roundMoney(catalogPrice - asNumber(explicitDiscount, 0));
  if (finalSalePrice < 0) {
    throw new BadRequestException('Le prix final ne peut pas être négatif.');
  }
  finalSalePrice = roundMoney(finalSalePrice);

  let discountAmount = roundMoney(catalogPrice - finalSalePrice);
  if (discountAmount < 0) {
    throw new BadRequestException('Le prix négocié ne peut pas dépasser le prix catalogue.');
  }

  if (explicitDiscount != null && negotiatedPrice != null) {
    const delta = Math.abs(roundMoney(catalogPrice - negotiatedPrice) - explicitDiscount);
    if (delta > 0.01) {
      throw new BadRequestException('Le prix négocié et la remise ne sont pas cohérents.');
    }
  }

  const depositType = dto.deposit_type;
  let depositAmount = 0;
  let depositPercentage: number | null = null;

  if (depositType === 'PERCENTAGE') {
    depositPercentage = roundMoney(asNumber(dto.deposit_percentage));
    depositAmount = roundMoney((finalSalePrice * depositPercentage) / 100);
  } else {
    depositAmount = roundMoney(asNumber(dto.deposit_amount));
    depositPercentage = finalSalePrice === 0 ? 0 : roundMoney((depositAmount / finalSalePrice) * 100);
  }

  if (depositAmount > finalSalePrice) {
    throw new BadRequestException("L'acompte ne peut pas dépasser le prix final.");
  }

  const minimumDepositType = settings?.minimum_deposit_type ?? 'PERCENTAGE';
  const minimumDepositPercentage = settings?.minimum_deposit_percentage != null ? Number(settings.minimum_deposit_percentage) : null;
  const minimumDepositAmount = settings?.minimum_deposit_amount != null ? Number(settings.minimum_deposit_amount) : null;

  if (minimumDepositType === 'PERCENTAGE' && minimumDepositPercentage != null && depositPercentage != null && depositPercentage + 0.001 < minimumDepositPercentage) {
    throw new BadRequestException(`L'acompte minimum doit être au moins de ${minimumDepositPercentage}%.`);
  }

  if (minimumDepositType === 'FIXED' && minimumDepositAmount != null && depositAmount + 0.001 < minimumDepositAmount) {
    throw new BadRequestException(`L'acompte minimum doit être au moins de ${minimumDepositAmount}.`);
  }

  const maximumInstallments = Number(settings?.maximum_installment_count ?? 24);
  const installmentCount = Number(dto.installment_count ?? 0);
  if (installmentCount < 0) {
    throw new BadRequestException("Le nombre d'échéances ne peut pas être négatif.");
  }
  if (installmentCount > maximumInstallments) {
    throw new BadRequestException(`Le nombre d'échéances dépasse le maximum autorisé (${maximumInstallments}).`);
  }

  const financedBalance = roundMoney(finalSalePrice - depositAmount);
  if (financedBalance > 0 && installmentCount <= 0) {
    throw new BadRequestException("Le nombre d'échéances doit être supérieur à zéro lorsqu'il reste un solde.");
  }
  if (financedBalance === 0 && installmentCount > 0) {
    throw new BadRequestException("Aucune échéance n'est nécessaire lorsque le solde est intégralement couvert.");
  }

  const frequency = dto.frequency;
  const gracePeriodDays = Number(dto.grace_period_days ?? settings?.grace_period_days ?? 0);
  const allowCustomSchedule = dto.allow_custom_schedule ?? settings?.allow_custom_schedule ?? true;
  const firstDueDate = dto.first_due_date ?? defaultFirstDueDate(gracePeriodDays);

  const installments: SalesSubscriptionInstallment[] = [];
  let regularInstallmentAmount = 0;
  let finalInstallmentAmount: number | null = null;

  if (depositAmount > 0) {
    installments.push({
      sequence_number: 1,
      label: 'Acompte',
      due_date: firstDueDate,
      amount: depositAmount,
      currency: dto.currency,
      installment_type: 'DEPOSIT',
    });
  }

  if (financedBalance > 0) {
    if (frequency === 'CUSTOM') {
      if (!allowCustomSchedule) {
        throw new BadRequestException("L'organisation n'autorise pas les échéanciers personnalisés.");
      }
      const customInstallments = Array.isArray(dto.custom_installments) ? dto.custom_installments : [];
      if (customInstallments.length === 0) {
        throw new BadRequestException('Les échéances personnalisées sont obligatoires pour une fréquence CUSTOM.');
      }
      const normalized = customInstallments
        .map((item, index) => ({
          sequence_number: item.sequence_number ?? index + 1,
          label: item.label?.trim() || `Échéance ${index + 1}`,
          due_date: item.due_date ? formatDate(parseDate(item.due_date, `La date de l'échéance ${index + 1}`)) : null,
          amount: roundMoney(asNumber(item.amount)),
          currency: item.currency,
          installment_type: item.installment_type ?? 'CUSTOM',
        }))
        .sort((a, b) => a.sequence_number - b.sequence_number);

      if (normalized.some((item) => !item.due_date)) {
        throw new BadRequestException('Chaque échéance personnalisée doit avoir une date.');
      }
      if (normalized.some((item) => item.currency !== dto.currency)) {
        throw new BadRequestException("Toutes les échéances doivent utiliser la même devise que la souscription.");
      }

      const customTotal = roundMoney(normalized.reduce((sum, item) => sum + item.amount, 0));
      if (Math.abs(customTotal - financedBalance) > 0.01) {
        throw new BadRequestException("Le total des échéances personnalisées doit correspondre exactement au solde financé.");
      }

      installments.push(
        ...normalized.map((item, index) => ({
          ...item,
          sequence_number: installments.length + index + 1,
          due_date: item.due_date!,
        })),
      );

      regularInstallmentAmount = normalized[0]?.amount ?? 0;
      finalInstallmentAmount = normalized.length > 1 ? normalized[normalized.length - 1].amount : normalized[0]?.amount ?? null;
    } else {
      const firstDate = parseDate(firstDueDate, 'La première échéance');
      const intervalMonths = frequency === 'QUARTERLY' ? 3 : 1;
      const baseAmount = roundMoney(financedBalance / installmentCount);
      let assigned = 0;
      for (let index = 0; index < installmentCount; index += 1) {
        const isLast = index === installmentCount - 1;
        const amount = isLast ? roundMoney(financedBalance - assigned) : baseAmount;
        assigned = roundMoney(assigned + amount);
        installments.push({
          sequence_number: installments.length + 1,
          label: installmentCount === 1 ? 'Solde final' : `Échéance ${index + 1}`,
          due_date: formatDate(addMonths(firstDate, intervalMonths * index)),
          amount,
          currency: dto.currency,
          installment_type: isLast && installmentCount > 1 ? 'FINAL' : 'REGULAR',
        });
      }
      regularInstallmentAmount = installmentCount > 1 ? installments[installments.length - installmentCount].amount : installments[installments.length - 1].amount;
      finalInstallmentAmount = installments[installments.length - 1]?.amount ?? null;
    }
  }

  const summary = {
    currency: dto.currency,
    catalog_price: catalogPrice,
    final_sale_price: finalSalePrice,
    discount_amount: discountAmount,
    total_installments: installments.length,
    deposit_amount: depositAmount,
    remaining_amount: financedBalance,
    approval_required:
      discountAmount > 0 &&
      Number(settings?.discount_approval_threshold_percentage ?? 0) >= 0 &&
      catalogPrice > 0 &&
      roundMoney((discountAmount / catalogPrice) * 100) > Number(settings?.discount_approval_threshold_percentage ?? 0),
    approval_reason:
      discountAmount > 0 &&
      Number(settings?.discount_approval_threshold_percentage ?? 0) >= 0 &&
      catalogPrice > 0 &&
      roundMoney((discountAmount / catalogPrice) * 100) > Number(settings?.discount_approval_threshold_percentage ?? 0)
        ? 'Remise supérieure au seuil autorisé.'
        : null,
  };

  return {
    summary,
    installments,
    derived: {
      final_sale_price: finalSalePrice,
      discount_amount: discountAmount,
      deposit_amount: depositAmount,
      deposit_percentage: depositPercentage,
      financed_balance: financedBalance,
      installment_count: financedBalance > 0 ? installments.filter((item) => item.installment_type !== 'DEPOSIT').length : 0,
      frequency,
      first_due_date: financedBalance > 0 ? firstDueDate : null,
      grace_period_days: gracePeriodDays,
      regular_installment_amount: roundMoney(regularInstallmentAmount),
      final_installment_amount: finalInstallmentAmount != null ? roundMoney(finalInstallmentAmount) : null,
    },
  };
}
