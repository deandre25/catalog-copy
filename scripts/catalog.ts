/**
 * Demo catalog: supplier-style specification blocks, the way a content team
 * actually receives them — inconsistent field names, units attached to some
 * numbers and not others, the occasional marketing word left in by the
 * supplier. Clean, uniform input would make the generation look better than
 * it is.
 */
export type SeedProduct = { title: string; rawInput: string };

export const CATALOG: SeedProduct[] = [
  // --- Laundry and kitchen appliances
  {
    title: "Bosch Serie 6 WAU28T64GB washing machine",
    rawInput: `Bosch WAU28T64GB Serie 6
Load: 9 kg | Spin: 1400 rpm
Energy class: B
Noise: 72 dB (spin), 50 dB (wash)
H848 x W598 x D590
i-DOS automatic dosing, AntiStain, EcoSilence Drive
Programmes: 14
Warranty: 2 years`,
  },
  {
    title: "Beko WTK84011 washing machine",
    rawInput: `BEKO WTK84011
capacity 8kg
spin speed 1400rpm
energy rating D
noise wash 56dB spin 76dB
dimensions 845x600x540mm
quick wash 28 min, daily xpress
no inverter motor
2 year guarantee, white`,
  },
  {
    title: "Hoover H-Dry 300 heat pump tumble dryer",
    rawInput: `Hoover H-Dry 300 HLE H9A2TCE
Type: heat pump condenser dryer
Drying capacity: 9 kg
Energy: A++
Noise: 66 dB
Sensor drying, Wi-Fi + Bluetooth (hOn app)
Reversible door
H850 x W595 x D610
Condensate tank, also plumbable`,
  },
  {
    title: "Beko DVN05320W dishwasher",
    rawInput: `Beko DVN05320W
Place settings: 13
Noise: 47 dB
Energy rating: E
Programmes: 5
Width: 598 mm, height 850, depth 600
Half load option: yes
Salt and rinse aid indicators
Warranty: 2 years`,
  },
  {
    title: "Bosch Serie 4 SMV4HVX38G integrated dishwasher",
    rawInput: `Bosch SMV4HVX38G Serie 4
fully integrated, 60cm
14 place settings
42 dB
energy class D
6 programmes incl. 1 hour eco
ExtraDry, InfoLight projects a dot on the floor while running
Home Connect wifi
cutlery drawer (3rd rack)`,
  },
  {
    title: "Russell Hobbs RH8URF55 under counter fridge",
    rawInput: `Russell Hobbs RH8URF55
Under counter larder fridge
Capacity: 133 L net
Energy: F
Noise: 40 dB
H845 x W545 x D570
Reversible door, 3 glass shelves, salad crisper
Adjustable thermostat
Freestanding only`,
  },

  // --- Small kitchen
  {
    title: "Sage Barista Express espresso machine",
    rawInput: `Sage the Barista Express SES875
Integrated conical burr grinder, 16 grind settings
54 mm portafilter
15 bar Italian pump
PID temperature control
Water tank: 2 L
Steam wand, manual microfoam
Dimensions 310 x 330 x 400 mm
Weight 10.4 kg
Stainless steel`,
  },
  {
    title: "Ninja Foodi MAX dual zone air fryer",
    rawInput: `Ninja Foodi MAX AF400UK
2 independent drawers, 9.5 L total (2 x 4.75 L)
6 functions: Max Crisp, Air Fry, Roast, Bake, Reheat, Dehydrate
Sync and Match cooking
2470 W
Dishwasher safe non-stick baskets
Fits 1.6 kg of fries total
Height 32.7 cm`,
  },
  {
    title: "KitchenAid Artisan 4.8L stand mixer",
    rawInput: `KitchenAid Artisan 5KSM185PS
Bowl: 4.8 litres stainless steel
Motor: 300 W direct drive
10 speeds, planetary mixing action
Tilt head, die cast metal body
Includes flat beater, dough hook, wire whisk, pouring shield
Hub takes over 15 optional attachments
Weight 10.9 kg
Available in 20+ colours`,
  },
  {
    title: "Instant Pot Duo 7-in-1 multi cooker 5.7L",
    rawInput: `Instant Pot Duo 60
7 appliances in one: pressure cooker, slow cooker, rice cooker, steamer, saute, yoghurt maker, warmer
5.7 litre stainless inner pot
13 one touch programmes
1000 W
10 safety mechanisms
Lid lock, steam release
Not an air fryer - no crisping lid included`,
  },

  // --- Audio and electronics
  {
    title: "Sony WH-1000XM5 wireless headphones",
    rawInput: `Sony WH-1000XM5
Over ear, closed back, wireless
ANC: 8 microphones, two processors
Battery: 30 h ANC on, 40 h off; 3 min charge = 3 h playback
Bluetooth 5.2, LDAC, multipoint
Weight: 250 g
Speak-to-chat, wear detection
Folds flat, carry case included
USB-C, 3.5 mm cable in box`,
  },
  {
    title: "Anker Soundcore Life Q30 headphones",
    rawInput: `Soundcore Life Q30 by Anker
hybrid active noise cancelling, 3 modes
40mm drivers
playtime 40 hours ANC on / 60 hours off
bluetooth 5.0, multipoint 2 devices
weight 260g
memory foam earcups
USB-C, 5 min charge = 4 hours
app with EQ`,
  },
  {
    title: "JBL Flip 6 portable speaker",
    rawInput: `JBL Flip 6
Output: 30 W (20 W woofer + 10 W tweeter)
IP67 dust and waterproof
Battery: 12 hours
Bluetooth 5.1, PartyBoost pairing
Dimensions 178 x 68 x 72 mm, 550 g
USB-C charging, no aux in
Racetrack driver`,
  },
  {
    title: "Kindle Paperwhite 11th generation 16GB",
    rawInput: `Kindle Paperwhite (2024) 16 GB
6.8 inch glare free display, 300 ppi
17 LEDs, adjustable warm light
IPX8 waterproof (2 m fresh water, 60 min)
Battery: up to 10 weeks
USB-C, wireless charging on Signature Edition only
Weight 205 g
No page turn buttons
Ads on lock screen unless you pay to remove`,
  },
  {
    title: "Logitech MX Master 3S wireless mouse",
    rawInput: `Logitech MX Master 3S
Sensor: 8000 DPI, works on glass
Quiet Click buttons, 90% less noise
MagSpeed electromagnetic scroll wheel, 1000 lines/sec
Bluetooth LE + Logi Bolt receiver, 3 devices
Battery: 70 days, 1 min charge = 3 hours
Weight: 141 g
Right handed shape only
USB-C`,
  },
  {
    title: "Samsung T7 Shield 2TB portable SSD",
    rawInput: `Samsung Portable SSD T7 Shield 2TB
Read 1050 MB/s, write 1000 MB/s
USB 3.2 Gen 2 (10 Gbps), USB-C
IP65 water and dust resistant
Drop resistant to 3 m
Rubber exterior
88 x 59 x 13 mm, 98 g
AES 256-bit hardware encryption
Works with PC, Mac, Android, consoles`,
  },

  // --- Tools and DIY
  {
    title: "DeWalt DCD796 18V combi drill",
    rawInput: `DeWalt DCD796 XR Brushless
18V, 2 speed (0-550 / 0-2000 rpm)
Torque 70 Nm
13 mm metal chuck
15 clutch settings + drill + hammer
Hammer rate 38250 bpm
Weight 1.6 kg bare
LED with 20 sec delay
Body only - batteries sold separately`,
  },
  {
    title: "Makita DTD153Z 18V impact driver",
    rawInput: `Makita DTD153Z
brushless impact driver LXT 18v
max torque 170 Nm
0-3400 rpm, 0-3600 ipm
1/4" hex chuck, one touch bit change
length 126mm, weight 1.5kg with battery
dual LED
body only, no battery no charger
vibration 11.5 m/s2`,
  },
  {
    title: "Bosch PST 900 PEL jigsaw",
    rawInput: `Bosch PST 900 PEL
620 W corded jigsaw
Stroke rate 500-3100 spm
Cutting depth: 90 mm wood, 8 mm steel, 15 mm aluminium
4 pendulum settings
Bevel to 45 degrees both ways
SDS tool free blade change
Integrated dust blower and extraction adapter
Weight 2.1 kg
Includes CutControl guide`,
  },
  {
    title: "Stanley FatMax 8m tape measure",
    rawInput: `Stanley FatMax 0-33-728
Blade length 8 m / 26 ft
Blade width 32 mm
Standout 3.3 m
Mylar polyester coated blade
Tru-Zero end hook, 3 rivets
Blade Armor coating on first 100 mm
Dual sided printing
Metric and imperial`,
  },
  {
    title: "Karcher K4 Power Control pressure washer",
    rawInput: `Karcher K4 Power Control
1800 W motor, water cooled
Pressure 20-130 bar
Flow rate 420 l/h
Vario Power lance with LCD pressure display
Dirt blaster lance included
Home Kit: T 5 patio cleaner + stone detergent
Hose 8 m, cable 5 m
Weight 12.1 kg
Not for hot water feed`,
  },

  // --- Garden and outdoor
  {
    title: "Gardena Classic 20m garden hose set",
    rawInput: `Gardena Classic 18/50 hose 20m
diameter 13mm (1/2")
4 layer reinforced PVC
max pressure 22 bar
UV resistant
kink resistant mesh
weight 2.6kg
includes 2 connectors and spray nozzle
12 year warranty`,
  },
  {
    title: "Flymo EasiLife 350 GO robotic lawnmower",
    rawInput: `Flymo EasiLife 350 GO
Lawn size up to 350 m2
Cutting width 17 cm, height 2-5 cm
3 pivoting razor blades
Battery 18V 2.0Ah Li-ion, 60 min run, 60 min charge
Noise 58 dB
Rain sensor, lift and tilt sensors, PIN lock
Boundary wire required (150 m included)
Slopes up to 25%`,
  },
  {
    title: "Weber Q1200 portable gas barbecue",
    rawInput: `Weber Q 1200
Single stainless steel burner, 3.5 kW
Cooking area 43 x 32 cm, porcelain enamelled cast iron grate
Push button ignition
Cast aluminium lid and body
Built in thermometer
Folding work tables
Runs on disposable gas cartridges; adapter hose for larger bottles sold separately
Weight 12.2 kg`,
  },
  {
    title: "Keter Store it Out Max garden storage box",
    rawInput: `Keter Store it Out Max
Capacity 1200 L
External 1455 x 1139 x 820 mm
Internal 1390 x 1060 x 770 mm
Resin, wood effect panels
Lockable (padlock not included), lid opens on hinges plus front doors
Weather resistant, UV treated
Floor panel included
Fits two wheelie bins or a bicycle`,
  },

  // --- Clothing and bags
  {
    title: "Patagonia Torrentshell 3L rain jacket",
    rawInput: `Patagonia Torrentshell 3L
3 layer H2No Performance Standard shell
Fabric: 3.3 oz recycled nylon ripstop, PFC-free DWR
Fully seam sealed
2 way adjustable hood, roll down and stows in pocket
Pit zips
Microfleece lined neck
Fair Trade Certified sewn
Weight 376 g (M)
Regular fit, packs into its own pocket`,
  },
  {
    title: "Uniqlo Ultra Light Down jacket",
    rawInput: `Uniqlo Ultra Light Down Jacket
Filling: 90% down, 10% feather
Shell: 100% nylon, ultra fine fibres
Weight approx 206 g
Packs into supplied pouch
Water repellent finish
Full zip, 2 side pockets
Machine washable
Not windproof-rated, no hood on this model`,
  },
  {
    title: "Dr. Martens 1460 leather boots",
    rawInput: `Dr. Martens 1460 8-eye boot
Upper: Smooth leather
Lining: textile and leather
Sole: Goodyear welted, heat sealed AirWair PVC
Slip resistant, oil and fat resistant, abrasion resistant
8 eyelets, yellow welt stitch
Heel height 3 cm
Break-in period expected
Unisex sizing, runs large`,
  },
  {
    title: "Osprey Farpoint 40 travel backpack",
    rawInput: `Osprey Farpoint 40
Volume 40 L (cabin size on most airlines)
Weight 1.46 kg
Fabric: 210D nylon mini hex diamond ripstop
Front panel zip opening, lockable
Padded laptop and tablet sleeve (15")
Stowaway harness and hip belt behind zip panel
Compression straps
No rain cover included
All Mighty Guarantee`,
  },
  {
    title: "Levi's 501 Original Fit jeans",
    rawInput: `Levi's 501 Original
Straight leg, regular fit through seat and thigh
Button fly
100% cotton denim (non-stretch on core washes)
Sits at waist
5 pocket styling, signature leather patch
Expect shrinkage on first wash if unwashed denim
Available 28-40 waist, 30/32/34 leg`,
  },

  // --- Sport and fitness
  {
    title: "Garmin Forerunner 265 running watch",
    rawInput: `Garmin Forerunner 265
1.3" AMOLED touchscreen, 416 x 416
Battery: 13 days smartwatch, 20 h GPS, 24 h in all-systems
Multi-band GNSS
Training readiness, HRV status, running power on the wrist
Elevate v5 heart rate sensor, Pulse Ox
Music storage, 500+ songs
5 ATM
Weight 47 g`,
  },
  {
    title: "Wahoo KICKR CORE smart trainer",
    rawInput: `Wahoo KICKR CORE
Direct drive turbo trainer
Max power 1800 W, max gradient 16%
Accuracy +/- 2%
Flywheel 5.4 kg
Connectivity ANT+ FE-C and Bluetooth
Noise 58 dB at 32 kph
Cassette NOT included on base model
Works with Zwift, TrainerRoad, Rouvy
Weight 18 kg`,
  },
  {
    title: "Decathlon Domyos adjustable dumbbell set 20kg",
    rawInput: `Domyos adjustable dumbbell kit 20 kg
2 handles, 35 cm
Plates: 4 x 2 kg, 4 x 1 kg, 4 x 0.5 kg
Cement filled plastic plates, not cast iron
Spin lock collars
Can be joined into one barbell with supplied connector
Max load per handle 10 kg
Floor protection recommended`,
  },
  {
    title: "Theragun Prime percussive massage device",
    rawInput: `Therabody Theragun Prime
Amplitude 16 mm
Speed range 1750-2400 ppm
Force up to 13.6 kg (30 lb) stall force
Battery 120 min
Noise: QuietForce technology
4 attachments: dampener, standard ball, thumb, cone
Bluetooth app with guided routines
Weight 1.02 kg
Ergonomic triangle handle`,
  },

  // --- Furniture and home
  {
    title: "Herman Miller Aeron Remastered office chair",
    rawInput: `Herman Miller Aeron (Remastered)
Sizes A, B, C - size B fits most
8Z Pellicle suspension, 8 zones of tension
PostureFit SL lumbar support
Tilt limiter and seat angle adjustment
Fully adjustable arms
Weight capacity 159 kg (size B)
12 year warranty
Fully recyclable, 91% recycled content on some finishes
No headrest from factory`,
  },
  {
    title: "IKEA MARKUS office chair",
    rawInput: `IKEA MARKUS
Mesh back, fabric seat
Height adjustable 46-57 cm
Tilt tension and lock
Built-in lumbar support
Seat depth 47 cm, width 53 cm
Max load 110 kg
10 year guarantee
Armrests not adjustable
Self assembly required`,
  },
  {
    title: "Philips Hue White and Colour starter kit E27",
    rawInput: `Philips Hue White and Color Ambiance starter kit
3 x E27 bulbs + Hue Bridge
1100 lumens per bulb (2024 revision)
16 million colours, 2000-6500K white
Zigbee via Bridge, Bluetooth without
Dimmable, no dimmer switch needed
9 W, equivalent 75 W
Lifetime 25000 hours
Works with Alexa, Google, HomeKit, Matter`,
  },
  {
    title: "Dyson V12 Detect Slim cordless vacuum",
    rawInput: `Dyson V12 Detect Slim Absolute
Suction 150 AW
Run time up to 60 min (no motorised tool)
Bin 0.35 L
Weight 2.2 kg
Laser Slim Fluffy head reveals dust on hard floors
Piezo sensor counts particles, LCD shows what it picked up
Whole machine HEPA filtration
3 power modes
Charge time 3.5 h`,
  },
];
