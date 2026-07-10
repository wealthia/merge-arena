// Server-authoritative product catalog. The client only ever sends a
// `productId` string — price and description always come from here, never
// from the client request, so a tampered client request can't buy a $90
// item for 1 Star.
const PRODUCTS = {
  energy_refill: { title: "Full Energy", description: "Fill energy to 20 instantly.", stars: 25 },
  energy_pack: { title: "+10 Energy", description: "Add 10 energy right now.", stars: 15 },
  rare_summon: { title: "Rare Hero", description: "Guaranteed Rare hero on your board.", stars: 40 },
  epic_summon: { title: "Epic Hero", description: "Guaranteed Epic hero on your board.", stars: 90 },
  power_surge: { title: "Power Boost", description: "+30% power for your next 3 fights.", stars: 35 },
  gem_starter: { title: "Gem Pack", description: "+500 gems for upgrades and progress.", stars: 50 }
};

function getProduct(productId) {
  return PRODUCTS[productId] || null;
}

module.exports = { PRODUCTS, getProduct };
