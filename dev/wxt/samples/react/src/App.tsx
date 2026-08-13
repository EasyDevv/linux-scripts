import React, { useState } from 'react';
import { Header } from './components/Header';
import { PricingCard } from './components/PricingCard';

export default function App() {
  const [isYearly, setIsYearly] = useState(true);

  const pricingPlans = [
    {
      title: 'Starter',
      price: 'Free',
      description: 'A great launchpad for beginners exploring the fundamentals.',
      buttonText: 'Start for Free',
      features: [
        'Host up to 20 projects',
        'Invite 2 team members',
        'Endless link sharing',
        'Standard security',
        'Cross-platform access',
      ],
    },
    {
      title: 'Pro',
      price: isYearly ? 25 : 30,
      period: isYearly ? 'yearly' : 'monthly',
      description: 'Built for serious creators demanding high performance.',
      buttonText: 'Choose Pro',
      isHighlighted: true,
      badgeText: 'Most Picked',
      features: [
        'All Starter benefits',
        '250 GB cloud storage',
        '1 TB media assets',
        'Up to 5 collaborators',
        'Password-protected links',
      ],
    },
    {
      title: 'Enterprise',
      price: isYearly ? 49 : 59,
      period: isYearly ? 'yearly' : 'monthly',
      description: 'Uncompromised power for growing organizations.',
      buttonText: 'Choose Enterprise',
      features: [
        'Everything in Pro',
        'Unified team hub',
        'Flexible storage limits',
        'White-label branding',
        '24/7 Priority support',
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-black selection:text-white">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-16 md:py-20 flex flex-col items-center">
        <h1 className="text-4xl md:text-[44px] font-bold text-center text-gray-900 mb-4 tracking-tight">
          Elevate Your Workflow Today
        </h1>
        <p className="text-gray-500 text-lg mb-12 text-center">
          Find the perfect subscription to scale your next big idea.
        </p>

        {/* Toggle */}
        <div className="flex items-center gap-4 mb-20 relative">
          <span
            className={`text-[15px] font-medium ${
              !isYearly ? 'text-black' : 'text-gray-500'
            }`}
          >
            Monthly
          </span>
          <button
            onClick={() => setIsYearly(!isYearly)}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-black transition-colors focus:outline-none"
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                isYearly ? 'translate-x-[26px]' : 'translate-x-1'
              }`}
            />
          </button>
          <span
            className={`text-[15px] font-bold ${
              isYearly ? 'text-black' : 'text-gray-500'
            }`}
          >
            Yearly
          </span>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8 w-full max-w-[1050px] items-start">
          {pricingPlans.map((plan, index) => (
            <PricingCard key={index} {...plan} />
          ))}
        </div>
      </main>
    </div>
  );
}
