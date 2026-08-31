import type { CostSnapshot } from '@urd/shared';

const labels: Record<string, string> = {
  academic_year: 'academic year',
  application_fee: 'application fee',
  average_full_time: 'average full-time',
  average_part_time: 'average part-time',
  books_and_supplies: 'books and supplies',
  cost_of_attendance_off_campus_not_with_family: 'off campus, not with family',
  cost_of_attendance_off_campus_with_family: 'off campus, with family',
  cost_of_attendance_on_campus: 'on campus',
  fees: 'fees',
  graduate: 'graduate',
  housing: 'housing',
  housing_and_meals: 'housing and meals',
  in_district: 'in district',
  in_state: 'in state',
  meals: 'meals',
  one_time: 'one time',
  out_of_state: 'out of state',
  published_2024_25: 'published 2024–25',
  tuition: 'tuition',
  tuition_and_fees: 'tuition + fees',
  undergraduate: 'undergraduate',
};

const readable = (value: string) => labels[value] ?? value.replaceAll('_', ' ');

export const formatCostAmount = (cost: Pick<CostSnapshot, 'amount' | 'currency'>) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cost.currency,
    maximumFractionDigits: 0,
  }).format(cost.amount);

type CostContext = Pick<
  CostSnapshot,
  'academicYear' | 'level' | 'residency' | 'category' | 'period' | 'scenario'
> & {
  source: {
    title: string;
    datasetVersion?: string | null | undefined;
    publisher?: string | null | undefined;
  };
};

export const formatCostContext = (cost: CostContext) => {
  const source = cost.source.datasetVersion ?? cost.source.publisher ?? cost.source.title;
  return [
    readable(cost.level),
    readable(cost.residency),
    readable(cost.category),
    readable(cost.period),
    readable(cost.scenario),
    cost.academicYear,
    source,
  ].join(' · ');
};

const primaryCostOrder = [
  {
    level: 'undergraduate',
    residency: 'out_of_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'undergraduate',
    residency: 'in_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'undergraduate',
    residency: 'in_district',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'graduate',
    residency: 'out_of_state',
    category: 'tuition_and_fees',
    period: 'academic_year',
    scenario: 'published_2024_25',
  },
  {
    level: 'undergraduate',
    residency: 'out_of_state',
    category: 'tuition',
    period: 'academic_year',
    scenario: 'average_full_time',
  },
] as const;

const primaryCostRank = (
  cost: Pick<CostSnapshot, 'level' | 'residency' | 'category' | 'period' | 'scenario'>,
) => {
  const rank = primaryCostOrder.findIndex(
    (preferred) =>
      cost.level === preferred.level &&
      cost.residency === preferred.residency &&
      cost.category === preferred.category &&
      cost.period === preferred.period &&
      cost.scenario === preferred.scenario,
  );
  return rank === -1 ? primaryCostOrder.length : rank;
};

export const primaryCost = <
  T extends Pick<CostSnapshot, 'level' | 'residency' | 'category' | 'period' | 'scenario'>,
>(
  costs: T[],
) => [...costs].sort((left, right) => primaryCostRank(left) - primaryCostRank(right))[0];
