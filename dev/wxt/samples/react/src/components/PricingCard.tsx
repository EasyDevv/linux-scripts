import { CheckIcon } from './Icons';

interface PricingCardProps {
  title: string;
  price: string | number;
  period?: string;
  description: string;
  buttonText: string;
  features: string[];
  isHighlighted?: boolean;
  badgeText?: string;
}

export const PricingCard = ({
  title,
  price,
  period,
  description,
  buttonText,
  features,
  isHighlighted = false,
  badgeText,
}: PricingCardProps) => {
  return (
    <div
      className={`bg-white rounded-3xl p-8 relative flex flex-col h-full ${
        isHighlighted
          ? 'border-[1.5px] border-black shadow-[0_20px_40px_rgb(0,0,0,0.08)] transform md:-translate-y-4 z-10'
          : 'border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-shadow'
      }`}
    >
      {isHighlighted && badgeText && (
        <div className="absolute top-0 right-8 transform -translate-y-1/2">
          <span className="bg-black text-white text-[13px] font-semibold px-4 py-1.5 rounded-full tracking-wide">
            {badgeText}
          </span>
        </div>
      )}

      <h3 className="text-xl font-medium text-gray-900 mb-6">{title}</h3>
      
      <div className="mb-4 flex items-baseline gap-1">
        <span className="text-[44px] font-bold tracking-tight">
          {typeof price === 'number' ? `$${price}` : price}
        </span>
        {period && (
          <>
            <span className="text-gray-400 font-medium text-2xl">/</span>
            <span className="text-gray-500 text-[15px]">{period}</span>
          </>
        )}
      </div>
      
      <p className="text-[15px] text-gray-500 h-14 mb-8 leading-relaxed">
        {description}
      </p>
      
      <button
        className={`w-full py-3 px-4 rounded-lg text-[15px] font-medium transition-colors mb-10 ${
          isHighlighted
            ? 'bg-black text-white hover:bg-gray-800'
            : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {buttonText}
      </button>
      
      <ul className="space-y-4 text-[15px] text-gray-600">
        {features.map((feature, index) => (
          <li key={index} className="flex items-center">
            <CheckIcon /> {feature}
          </li>
        ))}
      </ul>
    </div>
  );
};
