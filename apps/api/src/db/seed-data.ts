import type { UniversityInput } from '@urd/shared';

const verifiedAt = '2026-01-15T00:00:00.000Z';

export const seedUniversities: UniversityInput[] = [
  {
    name: 'University of British Columbia',
    slug: 'university-of-british-columbia',
    country: 'Canada',
    city: 'Vancouver',
    website: 'https://www.ubc.ca/',
    institutionType: 'public',
    studentCount: 70500,
    acceptanceRate: 52.4,
    annualTuitionUsd: 35000,
    ibTypicalMin: 34,
    featured: true,
    summary:
      'A research-intensive public university with a large Vancouver campus and broad strengths across science, engineering, business, and the humanities.',
    programs: [
      { name: 'Computer Science', level: 'undergraduate', field: 'Computer Science' },
      { name: 'Commerce', level: 'undergraduate', field: 'Business' },
    ],
    deadlines: [
      { label: 'General undergraduate application', date: '2027-01-15', applicantType: 'all' },
    ],
    sources: [
      {
        title: 'UBC undergraduate admissions',
        url: 'https://you.ubc.ca/applying-ubc/',
        category: 'official',
        verifiedAt,
      },
    ],
  },
  {
    name: 'University of Toronto',
    slug: 'university-of-toronto',
    country: 'Canada',
    city: 'Toronto',
    website: 'https://www.utoronto.ca/',
    institutionType: 'public',
    studentCount: 99000,
    acceptanceRate: 43,
    annualTuitionUsd: 45000,
    ibTypicalMin: 36,
    featured: true,
    summary:
      'A large public research university known for its academic breadth, three distinct campuses, and globally connected research community.',
    programs: [
      { name: 'Computer Science', level: 'undergraduate', field: 'Computer Science' },
      { name: 'Life Sciences', level: 'undergraduate', field: 'Biology' },
    ],
    deadlines: [
      { label: 'Recommended early application', date: '2026-11-07', applicantType: 'all' },
    ],
    sources: [
      {
        title: 'U of T future students',
        url: 'https://future.utoronto.ca/apply/',
        category: 'official',
        verifiedAt,
      },
    ],
  },
  {
    name: 'National University of Singapore',
    slug: 'national-university-of-singapore',
    country: 'Singapore',
    city: 'Singapore',
    website: 'https://nus.edu.sg/',
    institutionType: 'public',
    studentCount: 40000,
    acceptanceRate: null,
    annualTuitionUsd: 14500,
    ibTypicalMin: 38,
    featured: true,
    summary:
      'Singapore’s flagship research university, offering interdisciplinary education and a strong Asia-focused environment across a comprehensive program portfolio.',
    programs: [
      { name: 'Computer Science', level: 'undergraduate', field: 'Computer Science' },
      { name: 'Business Administration', level: 'undergraduate', field: 'Business' },
    ],
    deadlines: [
      {
        label: 'International qualifications application',
        date: '2027-02-26',
        applicantType: 'international',
      },
    ],
    sources: [
      {
        title: 'NUS undergraduate admissions',
        url: 'https://nus.edu.sg/oam/admissions',
        category: 'official',
        verifiedAt,
      },
    ],
  },
  {
    name: 'University of Melbourne',
    slug: 'university-of-melbourne',
    country: 'Australia',
    city: 'Melbourne',
    website: 'https://www.unimelb.edu.au/',
    institutionType: 'public',
    studentCount: 54000,
    acceptanceRate: null,
    annualTuitionUsd: 33000,
    ibTypicalMin: 31,
    featured: false,
    summary:
      'A comprehensive public research university with a flexible undergraduate curriculum and a central campus in one of Australia’s major student cities.',
    programs: [
      { name: 'Bachelor of Science', level: 'undergraduate', field: 'Science' },
      { name: 'Bachelor of Commerce', level: 'undergraduate', field: 'Business' },
    ],
    deadlines: [
      {
        label: 'Semester 1 timely application',
        date: '2026-10-31',
        applicantType: 'international',
      },
    ],
    sources: [
      {
        title: 'Melbourne international applications',
        url: 'https://study.unimelb.edu.au/how-to-apply/undergraduate-study/international-applications',
        category: 'official',
        verifiedAt,
      },
    ],
  },
  {
    name: 'Delft University of Technology',
    slug: 'delft-university-of-technology',
    country: 'Netherlands',
    city: 'Delft',
    website: 'https://www.tudelft.nl/en/',
    institutionType: 'public',
    studentCount: 27000,
    acceptanceRate: null,
    annualTuitionUsd: 18000,
    ibTypicalMin: null,
    featured: false,
    summary:
      'A technology-focused public university with project-based engineering education and internationally oriented programs in design, science, and computing.',
    programs: [
      {
        name: 'Computer Science and Engineering',
        level: 'undergraduate',
        field: 'Computer Science',
      },
      { name: 'Aerospace Engineering', level: 'undergraduate', field: 'Engineering' },
    ],
    deadlines: [{ label: 'Numerus fixus deadline', date: '2027-01-15', applicantType: 'all' }],
    sources: [
      {
        title: 'TU Delft admission and application',
        url: 'https://www.tudelft.nl/en/education/admission-and-application',
        category: 'official',
        verifiedAt,
      },
    ],
  },
  {
    name: 'University of Hong Kong',
    slug: 'university-of-hong-kong',
    country: 'Hong Kong',
    city: 'Hong Kong',
    website: 'https://www.hku.hk/',
    institutionType: 'public',
    studentCount: 39000,
    acceptanceRate: null,
    annualTuitionUsd: 22000,
    ibTypicalMin: 36,
    featured: false,
    summary:
      'A research-led university offering English-medium education and a broad range of professional and academic programs in a highly international city.',
    programs: [
      { name: 'Bachelor of Engineering', level: 'undergraduate', field: 'Engineering' },
      { name: 'Bachelor of Business Administration', level: 'undergraduate', field: 'Business' },
    ],
    deadlines: [
      { label: 'First-round evaluation', date: '2026-11-26', applicantType: 'international' },
    ],
    sources: [
      {
        title: 'HKU international admissions',
        url: 'https://admissions.hku.hk/apply/international-qualifications',
        category: 'official',
        verifiedAt,
      },
    ],
  },
];
