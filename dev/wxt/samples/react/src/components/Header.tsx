export const Header = () => {
  return (
    <header className="max-w-7xl mx-auto flex items-center justify-between px-6 py-8 md:px-12">
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold tracking-tight">SAMPLE</span>
      </div>
      
      <nav className="hidden md:flex items-center gap-8 text-[15px] font-medium text-gray-500">
        <a href="#" className="hover:text-black transition-colors">Home</a>
        <a href="#" className="text-black font-semibold">Pricing</a>
        <a href="#" className="hover:text-black transition-colors">About</a>
        <a href="#" className="hover:text-black transition-colors">Contact</a>
      </nav>
      
      <div>
        <button className="bg-[#111] text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-black transition-colors">
          Sign In
        </button>
      </div>
    </header>
  );
};
