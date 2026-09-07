// Hand-written fixture catalog for the mock API adapter (src/api/mock.ts).
//
// Four film years, one per era, with roughly ten contenders per category.
// Titles and people are recognisable so the game feels real, but every
// number (ratings, votes, revenue, metrics) is a plausible fabrication —
// the real catalog comes from the data pipeline (docs/DATA.md). The
// `academy` column (100 win / 60 nomination / 0) is what results reveal.

import type { Category, Contender, ContenderMetrics, ContenderStats } from "./types";

/** One film in a fixture year. Stats are film-level and shared by contenders. */
export interface FixtureFilm {
  id: string; // fake IMDb tconst
  title: string;
  rating: number; // IMDb-style 0-10
  votesK: number; // thousands of votes
  revenueM: number | null; // box office in USD millions, null when unknown
  runtime: number;
  genres: string[];
  archetype: string;
}

/** A contender row: [film index, person name, character, academy]. */
type Row = [film: number, person: string | null, character: string | null, academy: 0 | 60 | 100];

export interface FixtureYear {
  year: number;
  films: FixtureFilm[];
  contenders: Record<Category, Row[]>;
}

export const ARCHETYPES = [
  "Critical Darling",
  "Crowd-Pleaser",
  "Prestige Drama",
  "Cult Favourite",
  "Blockbuster",
  "Genre Picture",
] as const;

// ---------------------------------------------------------------- 1939 ----
const y1939: FixtureYear = {
  year: 1939,
  films: [
    { id: "tt0031381", title: "Gone with the Wind", rating: 8.2, votesK: 330, revenueM: 400, runtime: 238, genres: ["Drama", "Romance", "War"], archetype: "Prestige Drama" },
    { id: "tt0032138", title: "The Wizard of Oz", rating: 8.1, votesK: 420, revenueM: 30, runtime: 102, genres: ["Adventure", "Family", "Fantasy"], archetype: "Crowd-Pleaser" },
    { id: "tt0031679", title: "Mr. Smith Goes to Washington", rating: 8.1, votesK: 120, revenueM: 9, runtime: 129, genres: ["Comedy", "Drama"], archetype: "Critical Darling" },
    { id: "tt0031971", title: "Stagecoach", rating: 7.8, votesK: 50, revenueM: 3, runtime: 96, genres: ["Adventure", "Drama", "Western"], archetype: "Genre Picture" },
    { id: "tt0032145", title: "Wuthering Heights", rating: 7.5, votesK: 20, revenueM: 4, runtime: 104, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0031725", title: "Ninotchka", rating: 7.8, votesK: 25, revenueM: 2, runtime: 110, genres: ["Comedy", "Romance"], archetype: "Critical Darling" },
    { id: "tt0031385", title: "Goodbye, Mr. Chips", rating: 7.8, votesK: 12, revenueM: 3, runtime: 114, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0031210", title: "Dark Victory", rating: 7.4, votesK: 12, revenueM: 2, runtime: 104, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0031742", title: "Of Mice and Men", rating: 7.7, votesK: 8, revenueM: null, runtime: 106, genres: ["Drama"], archetype: "Critical Darling" },
    { id: "tt0031593", title: "Love Affair", rating: 7.1, votesK: 5, revenueM: null, runtime: 88, genres: ["Comedy", "Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0031762", title: "Only Angels Have Wings", rating: 7.6, votesK: 16, revenueM: 2, runtime: 121, genres: ["Adventure", "Drama", "Romance"], archetype: "Cult Favourite" },
    { id: "tt0032143", title: "The Women", rating: 7.5, votesK: 13, revenueM: 2, runtime: 133, genres: ["Comedy", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0031398", title: "Gunga Din", rating: 7.2, votesK: 10, revenueM: 3, runtime: 117, genres: ["Adventure", "Comedy", "War"], archetype: "Genre Picture" },
    { id: "tt0032155", title: "Young Mr. Lincoln", rating: 7.5, votesK: 9, revenueM: null, runtime: 100, genres: ["Biography", "Drama"], archetype: "Prestige Drama" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [1, null, null, 60], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 60], [6, null, null, 60], [7, null, null, 60], [8, null, null, 60], [9, null, null, 60], [10, null, null, 0], [11, null, null, 0], [12, null, null, 0]],
    director: [[0, "Victor Fleming", null, 100], [2, "Frank Capra", null, 60], [3, "John Ford", null, 60], [4, "William Wyler", null, 60], [6, "Sam Wood", null, 60], [5, "Ernst Lubitsch", null, 0], [10, "Howard Hawks", null, 0], [11, "George Cukor", null, 0], [7, "Edmund Goulding", null, 0], [8, "Lewis Milestone", null, 0], [13, "John Ford", null, 0]],
    actor: [[6, "Robert Donat", "Mr. Chipping", 100], [0, "Clark Gable", "Rhett Butler", 60], [2, "James Stewart", "Jefferson Smith", 60], [4, "Laurence Olivier", "Heathcliff", 60], [10, "Cary Grant", "Geoff Carter", 0], [3, "John Wayne", "The Ringo Kid", 0], [5, "Melvyn Douglas", "Count Leon d'Algout", 0], [8, "Burgess Meredith", "George Milton", 0], [9, "Charles Boyer", "Michel Marnet", 0], [13, "Henry Fonda", "Abraham Lincoln", 0], [12, "Cary Grant", "Sgt. Cutter", 0]],
    actress: [[0, "Vivien Leigh", "Scarlett O'Hara", 100], [7, "Bette Davis", "Judith Traherne", 60], [5, "Greta Garbo", "Ninotchka", 60], [9, "Irene Dunne", "Terry McKay", 60], [6, "Greer Garson", "Katherine Chipping", 60], [1, "Judy Garland", "Dorothy Gale", 0], [4, "Merle Oberon", "Cathy", 0], [2, "Jean Arthur", "Clarissa Saunders", 0], [3, "Claire Trevor", "Dallas", 0], [11, "Norma Shearer", "Mary Haines", 0], [10, "Jean Arthur", "Bonnie Lee", 0]],
    supporting_actor: [[3, "Thomas Mitchell", "Doc Boone", 100], [2, "Claude Rains", "Senator Joseph Paine", 60], [2, "Harry Carey", "President of the Senate", 60], [0, "Leslie Howard", "Ashley Wilkes", 0], [1, "Frank Morgan", "The Wizard", 0], [1, "Ray Bolger", "The Scarecrow", 0], [8, "Lon Chaney Jr.", "Lennie Small", 0], [10, "Richard Barthelmess", "Bat MacPherson", 0], [3, "Andy Devine", "Buck", 0], [12, "Victor McLaglen", "Sgt. MacChesney", 0], [0, "Thomas Mitchell", "Gerald O'Hara", 0]],
    supporting_actress: [[0, "Hattie McDaniel", "Mammy", 100], [0, "Olivia de Havilland", "Melanie Hamilton", 60], [4, "Geraldine Fitzgerald", "Isabella Linton", 60], [9, "Maria Ouspenskaya", "Grandmother Janou", 60], [1, "Margaret Hamilton", "The Wicked Witch of the West", 0], [5, "Ina Claire", "Grand Duchess Swana", 0], [11, "Joan Crawford", "Crystal Allen", 0], [11, "Rosalind Russell", "Sylvia Fowler", 0], [1, "Billie Burke", "Glinda", 0], [4, "Flora Robson", "Ellen Dean", 0]],
  },
};

// ---------------------------------------------------------------- 1975 ----
const y1975: FixtureYear = {
  year: 1975,
  films: [
    { id: "tt0073486", title: "One Flew Over the Cuckoo's Nest", rating: 8.7, votesK: 1050, revenueM: 109, runtime: 133, genres: ["Drama"], archetype: "Critical Darling" },
    { id: "tt0073195", title: "Jaws", rating: 8.1, votesK: 640, revenueM: 476, runtime: 124, genres: ["Adventure", "Thriller"], archetype: "Blockbuster" },
    { id: "tt0072890", title: "Dog Day Afternoon", rating: 8.0, votesK: 270, revenueM: 50, runtime: 125, genres: ["Biography", "Crime", "Drama"], archetype: "Critical Darling" },
    { id: "tt0073440", title: "Nashville", rating: 7.6, votesK: 30, revenueM: 10, runtime: 160, genres: ["Comedy", "Drama", "Music"], archetype: "Critical Darling" },
    { id: "tt0072684", title: "Barry Lyndon", rating: 8.1, votesK: 190, revenueM: 20, runtime: 185, genres: ["Adventure", "Drama", "War"], archetype: "Prestige Drama" },
    { id: "tt0071853", title: "Monty Python and the Holy Grail", rating: 8.2, votesK: 570, revenueM: 5, runtime: 91, genres: ["Adventure", "Comedy", "Fantasy"], archetype: "Cult Favourite" },
    { id: "tt0073629", title: "The Rocky Horror Picture Show", rating: 7.4, votesK: 160, revenueM: 113, runtime: 100, genres: ["Comedy", "Horror", "Musical"], archetype: "Cult Favourite" },
    { id: "tt0073802", title: "Three Days of the Condor", rating: 7.4, votesK: 70, revenueM: 42, runtime: 117, genres: ["Mystery", "Thriller"], archetype: "Genre Picture" },
    { id: "tt0073341", title: "The Man Who Would Be King", rating: 7.8, votesK: 50, revenueM: 11, runtime: 129, genres: ["Adventure", "War"], archetype: "Genre Picture" },
    { id: "tt0073692", title: "Shampoo", rating: 6.4, votesK: 15, revenueM: 50, runtime: 110, genres: ["Comedy", "Drama", "Romance"], archetype: "Crowd-Pleaser" },
    { id: "tt0073766", title: "The Sunshine Boys", rating: 7.2, votesK: 12, revenueM: 13, runtime: 111, genres: ["Comedy"], archetype: "Crowd-Pleaser" },
    { id: "tt0073312", title: "Love and Death", rating: 7.6, votesK: 40, revenueM: 20, runtime: 85, genres: ["Comedy", "War"], archetype: "Cult Favourite" },
    { id: "tt0073812", title: "Tommy", rating: 6.6, votesK: 16, revenueM: 34, runtime: 111, genres: ["Drama", "Musical"], archetype: "Cult Favourite" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [1, null, null, 60], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 0], [6, null, null, 0], [7, null, null, 0], [8, null, null, 0], [9, null, null, 0], [11, null, null, 0]],
    director: [[0, "Milos Forman", null, 100], [2, "Sidney Lumet", null, 60], [3, "Robert Altman", null, 60], [4, "Stanley Kubrick", null, 60], [1, "Steven Spielberg", null, 0], [8, "John Huston", null, 0], [9, "Hal Ashby", null, 0], [7, "Sydney Pollack", null, 0], [5, "Terry Gilliam", null, 0], [11, "Woody Allen", null, 0], [12, "Ken Russell", null, 0]],
    actor: [[0, "Jack Nicholson", "R.P. McMurphy", 100], [2, "Al Pacino", "Sonny Wortzik", 60], [10, "Walter Matthau", "Willy Clark", 60], [1, "Roy Scheider", "Chief Martin Brody", 0], [8, "Sean Connery", "Daniel Dravot", 0], [4, "Ryan O'Neal", "Redmond Barry", 0], [7, "Robert Redford", "Joe Turner", 0], [9, "Warren Beatty", "George Roundy", 0], [5, "Graham Chapman", "King Arthur", 0], [6, "Tim Curry", "Dr. Frank-N-Furter", 0], [11, "Woody Allen", "Boris Grushenko", 0]],
    actress: [[0, "Louise Fletcher", "Nurse Ratched", 100], [12, "Ann-Margret", "Nora Walker", 60], [11, "Diane Keaton", "Sonja", 0], [7, "Faye Dunaway", "Kathy Hale", 0], [9, "Julie Christie", "Jackie Shawn", 0], [6, "Susan Sarandon", "Janet Weiss", 0], [4, "Marisa Berenson", "Lady Lyndon", 0], [1, "Lorraine Gary", "Ellen Brody", 0], [3, "Karen Black", "Connie White", 0], [9, "Goldie Hawn", "Jill Haynes", 0]],
    supporting_actor: [[10, "George Burns", "Al Lewis", 100], [0, "Brad Dourif", "Billy Bibbit", 60], [2, "Chris Sarandon", "Leon Shermer", 60], [9, "Jack Warden", "Lester Karpf", 60], [1, "Robert Shaw", "Quint", 0], [1, "Richard Dreyfuss", "Matt Hooper", 0], [8, "Michael Caine", "Peachy Carnehan", 0], [2, "John Cazale", "Sal", 0], [3, "Henry Gibson", "Haven Hamilton", 0], [4, "Patrick Magee", "The Chevalier", 0], [0, "Will Sampson", "Chief Bromden", 0]],
    supporting_actress: [[9, "Lee Grant", "Felicia Karpf", 100], [3, "Ronee Blakley", "Barbara Jean", 60], [3, "Lily Tomlin", "Linnea Reese", 60], [3, "Geraldine Chaplin", "Opal", 0], [3, "Barbara Harris", "Albuquerque", 0], [6, "Nell Campbell", "Columbia", 0], [12, "Tina Turner", "The Acid Queen", 0], [0, "Louise Fletcher", "Nurse Ratched", 0], [2, "Penelope Allen", "Sylvia", 0], [4, "Marie Kean", "Barry's Mother", 0]],
  },
};

// ---------------------------------------------------------------- 1994 ----
const y1994: FixtureYear = {
  year: 1994,
  films: [
    { id: "tt0109830", title: "Forrest Gump", rating: 8.8, votesK: 2300, revenueM: 678, runtime: 142, genres: ["Drama", "Romance"], archetype: "Crowd-Pleaser" },
    { id: "tt0110912", title: "Pulp Fiction", rating: 8.9, votesK: 2250, revenueM: 214, runtime: 154, genres: ["Crime", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0111161", title: "The Shawshank Redemption", rating: 9.3, votesK: 2900, revenueM: 73, runtime: 142, genres: ["Drama"], archetype: "Critical Darling" },
    { id: "tt0110932", title: "Quiz Show", rating: 7.5, votesK: 60, revenueM: 52, runtime: 133, genres: ["Biography", "Drama", "History"], archetype: "Prestige Drama" },
    { id: "tt0109831", title: "Four Weddings and a Funeral", rating: 7.1, votesK: 160, revenueM: 245, runtime: 117, genres: ["Comedy", "Drama", "Romance"], archetype: "Crowd-Pleaser" },
    { id: "tt0110357", title: "The Lion King", rating: 8.5, votesK: 1150, revenueM: 968, runtime: 88, genres: ["Adventure", "Animation", "Drama"], archetype: "Blockbuster" },
    { id: "tt0109707", title: "Ed Wood", rating: 7.8, votesK: 190, revenueM: 6, runtime: 127, genres: ["Biography", "Comedy", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0109348", title: "Bullets Over Broadway", rating: 7.4, votesK: 40, revenueM: 13, runtime: 98, genres: ["Comedy", "Crime"], archetype: "Critical Darling" },
    { id: "tt0111257", title: "Speed", rating: 7.3, votesK: 400, revenueM: 350, runtime: 116, genres: ["Action", "Adventure", "Thriller"], archetype: "Blockbuster" },
    { id: "tt0110005", title: "Heavenly Creatures", rating: 7.3, votesK: 60, revenueM: 3, runtime: 99, genres: ["Biography", "Crime", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0110632", title: "Nobody's Fool", rating: 7.3, votesK: 20, revenueM: 39, runtime: 110, genres: ["Comedy", "Drama"], archetype: "Prestige Drama" },
    { id: "tt0109370", title: "Blue Sky", rating: 6.4, votesK: 6, revenueM: 3, runtime: 101, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0110367", title: "Little Women", rating: 7.3, votesK: 40, revenueM: 50, runtime: 115, genres: ["Drama", "Family", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0110413", title: "Léon: The Professional", rating: 8.5, votesK: 1250, revenueM: 46, runtime: 110, genres: ["Action", "Crime", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0109445", title: "Clerks", rating: 7.7, votesK: 240, revenueM: 3, runtime: 92, genres: ["Comedy"], archetype: "Cult Favourite" },
    { id: "tt0111503", title: "True Lies", rating: 7.3, votesK: 300, revenueM: 379, runtime: 141, genres: ["Action", "Comedy", "Thriller"], archetype: "Blockbuster" },
    { id: "tt0110148", title: "Interview with the Vampire", rating: 7.5, votesK: 350, revenueM: 224, runtime: 123, genres: ["Drama", "Fantasy", "Horror"], archetype: "Genre Picture" },
    { id: "tt0111495", title: "Three Colours: Red", rating: 8.1, votesK: 110, revenueM: 4, runtime: 99, genres: ["Drama", "Mystery", "Romance"], archetype: "Critical Darling" },
    { id: "tt0110428", title: "The Madness of King George", rating: 7.2, votesK: 20, revenueM: 15, runtime: 110, genres: ["Biography", "Comedy", "Drama"], archetype: "Prestige Drama" },
    { id: "tt0110638", title: "Nell", rating: 6.5, votesK: 30, revenueM: 106, runtime: 112, genres: ["Drama"], archetype: "Prestige Drama" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [1, null, null, 60], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 0], [6, null, null, 0], [8, null, null, 0], [9, null, null, 0], [13, null, null, 0], [14, null, null, 0], [7, null, null, 0], [17, null, null, 0]],
    director: [[0, "Robert Zemeckis", null, 100], [1, "Quentin Tarantino", null, 60], [3, "Robert Redford", null, 60], [7, "Woody Allen", null, 60], [17, "Krzysztof Kieslowski", null, 60], [2, "Frank Darabont", null, 0], [6, "Tim Burton", null, 0], [9, "Peter Jackson", null, 0], [13, "Luc Besson", null, 0], [14, "Kevin Smith", null, 0], [15, "James Cameron", null, 0], [8, "Jan de Bont", null, 0]],
    actor: [[0, "Tom Hanks", "Forrest Gump", 100], [2, "Morgan Freeman", "Ellis Boyd 'Red' Redding", 60], [1, "John Travolta", "Vincent Vega", 60], [10, "Paul Newman", "Donald 'Sully' Sullivan", 60], [18, "Nigel Hawthorne", "King George III", 60], [2, "Tim Robbins", "Andy Dufresne", 0], [6, "Johnny Depp", "Ed Wood", 0], [4, "Hugh Grant", "Charles", 0], [8, "Keanu Reeves", "Jack Traven", 0], [3, "Ralph Fiennes", "Charles Van Doren", 0], [13, "Jean Reno", "Léon", 0], [16, "Tom Cruise", "Lestat", 0]],
    actress: [[11, "Jessica Lange", "Carly Marshall", 100], [19, "Jodie Foster", "Nell Kellty", 60], [12, "Winona Ryder", "Jo March", 60], [4, "Andie MacDowell", "Carrie", 0], [8, "Sandra Bullock", "Annie Porter", 0], [9, "Kate Winslet", "Juliet Hulme", 0], [9, "Melanie Lynskey", "Pauline Parker", 0], [13, "Natalie Portman", "Mathilda", 0], [15, "Jamie Lee Curtis", "Helen Tasker", 0], [0, "Robin Wright", "Jenny Curran", 0], [17, "Irène Jacob", "Valentine", 0]],
    supporting_actor: [[6, "Martin Landau", "Bela Lugosi", 100], [1, "Samuel L. Jackson", "Jules Winnfield", 60], [0, "Gary Sinise", "Lt. Dan Taylor", 60], [3, "Paul Scofield", "Mark Van Doren", 60], [7, "Chazz Palminteri", "Cheech", 60], [8, "Dennis Hopper", "Howard Payne", 0], [13, "Gary Oldman", "Norman Stansfield", 0], [1, "Bruce Willis", "Butch Coolidge", 0], [3, "John Turturro", "Herb Stempel", 0], [2, "Bob Gunton", "Warden Norton", 0], [5, "Jeremy Irons", "Scar", 0], [16, "Brad Pitt", "Louis", 0]],
    supporting_actress: [[7, "Dianne Wiest", "Helen Sinclair", 100], [1, "Uma Thurman", "Mia Wallace", 60], [18, "Helen Mirren", "Queen Charlotte", 60], [7, "Jennifer Tilly", "Olive Neal", 60], [0, "Sally Field", "Mrs. Gump", 0], [16, "Kirsten Dunst", "Claudia", 0], [4, "Kristin Scott Thomas", "Fiona", 0], [6, "Sarah Jessica Parker", "Dolores Fuller", 0], [6, "Patricia Arquette", "Kathy O'Hara", 0], [12, "Claire Danes", "Beth March", 0], [12, "Kirsten Dunst", "Young Amy March", 0]],
  },
};

// ---------------------------------------------------------------- 2008 ----
const y2008: FixtureYear = {
  year: 2008,
  films: [
    { id: "tt1010048", title: "Slumdog Millionaire", rating: 8.0, votesK: 880, revenueM: 378, runtime: 120, genres: ["Crime", "Drama", "Romance"], archetype: "Critical Darling" },
    { id: "tt0468569", title: "The Dark Knight", rating: 9.0, votesK: 2900, revenueM: 1006, runtime: 152, genres: ["Action", "Crime", "Drama"], archetype: "Blockbuster" },
    { id: "tt0421715", title: "The Curious Case of Benjamin Button", rating: 7.8, votesK: 680, revenueM: 336, runtime: 166, genres: ["Drama", "Fantasy", "Romance"], archetype: "Prestige Drama" },
    { id: "tt1013753", title: "Milk", rating: 7.5, votesK: 180, revenueM: 54, runtime: 128, genres: ["Biography", "Drama", "History"], archetype: "Prestige Drama" },
    { id: "tt0870111", title: "Frost/Nixon", rating: 7.7, votesK: 110, revenueM: 27, runtime: 122, genres: ["Biography", "Drama", "History"], archetype: "Prestige Drama" },
    { id: "tt0976051", title: "The Reader", rating: 7.6, votesK: 240, revenueM: 108, runtime: 124, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0910970", title: "WALL·E", rating: 8.4, votesK: 1200, revenueM: 521, runtime: 98, genres: ["Adventure", "Animation", "Family"], archetype: "Crowd-Pleaser" },
    { id: "tt1125849", title: "The Wrestler", rating: 7.9, votesK: 310, revenueM: 44, runtime: 109, genres: ["Drama", "Sport"], archetype: "Critical Darling" },
    { id: "tt0918927", title: "Doubt", rating: 7.5, votesK: 130, revenueM: 51, runtime: 104, genres: ["Drama", "Mystery"], archetype: "Prestige Drama" },
    { id: "tt1205489", title: "Gran Torino", rating: 8.1, votesK: 800, revenueM: 270, runtime: 116, genres: ["Drama"], archetype: "Crowd-Pleaser" },
    { id: "tt0371746", title: "Iron Man", rating: 7.9, votesK: 1100, revenueM: 585, runtime: 126, genres: ["Action", "Adventure", "Sci-Fi"], archetype: "Blockbuster" },
    { id: "tt0780536", title: "In Bruges", rating: 7.9, votesK: 440, revenueM: 34, runtime: 107, genres: ["Comedy", "Crime", "Drama"], archetype: "Cult Favourite" },
    { id: "tt1084950", title: "Rachel Getting Married", rating: 6.7, votesK: 40, revenueM: 16, runtime: 113, genres: ["Drama"], archetype: "Critical Darling" },
    { id: "tt0824747", title: "Changeling", rating: 7.7, votesK: 260, revenueM: 113, runtime: 141, genres: ["Biography", "Crime", "Drama"], archetype: "Prestige Drama" },
    { id: "tt0497465", title: "Vicky Cristina Barcelona", rating: 7.0, votesK: 130, revenueM: 96, runtime: 96, genres: ["Comedy", "Drama", "Romance"], archetype: "Crowd-Pleaser" },
    { id: "tt0959337", title: "Revolutionary Road", rating: 7.3, votesK: 220, revenueM: 76, runtime: 119, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0942385", title: "Tropic Thunder", rating: 7.1, votesK: 440, revenueM: 195, runtime: 107, genres: ["Action", "Comedy", "War"], archetype: "Crowd-Pleaser" },
    { id: "tt0857191", title: "The Visitor", rating: 7.6, votesK: 40, revenueM: 18, runtime: 104, genres: ["Drama"], archetype: "Critical Darling" },
    { id: "tt0978759", title: "Frozen River", rating: 7.1, votesK: 20, revenueM: 5, runtime: 97, genres: ["Crime", "Drama"], archetype: "Critical Darling" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 60], [1, null, null, 0], [6, null, null, 0], [7, null, null, 0], [8, null, null, 0], [9, null, null, 0], [10, null, null, 0], [11, null, null, 0]],
    director: [[0, "Danny Boyle", null, 100], [2, "David Fincher", null, 60], [3, "Gus Van Sant", null, 60], [4, "Ron Howard", null, 60], [5, "Stephen Daldry", null, 60], [1, "Christopher Nolan", null, 0], [7, "Darren Aronofsky", null, 0], [6, "Andrew Stanton", null, 0], [9, "Clint Eastwood", null, 0], [10, "Jon Favreau", null, 0], [11, "Martin McDonagh", null, 0], [12, "Jonathan Demme", null, 0]],
    actor: [[3, "Sean Penn", "Harvey Milk", 100], [7, "Mickey Rourke", "Randy 'The Ram' Robinson", 60], [4, "Frank Langella", "Richard Nixon", 60], [2, "Brad Pitt", "Benjamin Button", 60], [17, "Richard Jenkins", "Walter Vale", 60], [1, "Christian Bale", "Bruce Wayne", 0], [9, "Clint Eastwood", "Walt Kowalski", 0], [10, "Robert Downey Jr.", "Tony Stark", 0], [11, "Colin Farrell", "Ray", 0], [0, "Dev Patel", "Jamal Malik", 0], [15, "Leonardo DiCaprio", "Frank Wheeler", 0], [4, "Michael Sheen", "David Frost", 0]],
    actress: [[5, "Kate Winslet", "Hanna Schmitz", 100], [12, "Anne Hathaway", "Kym", 60], [13, "Angelina Jolie", "Christine Collins", 60], [18, "Melissa Leo", "Ray Eddy", 60], [8, "Meryl Streep", "Sister Aloysius", 60], [2, "Cate Blanchett", "Daisy", 0], [14, "Rebecca Hall", "Vicky", 0], [14, "Scarlett Johansson", "Cristina", 0], [0, "Freida Pinto", "Latika", 0], [1, "Maggie Gyllenhaal", "Rachel Dawes", 0], [15, "Kate Winslet", "April Wheeler", 0], [10, "Gwyneth Paltrow", "Pepper Potts", 0]],
    supporting_actor: [[1, "Heath Ledger", "The Joker", 100], [3, "Josh Brolin", "Dan White", 60], [16, "Robert Downey Jr.", "Kirk Lazarus", 60], [8, "Philip Seymour Hoffman", "Father Flynn", 60], [15, "Michael Shannon", "John Givings", 60], [1, "Aaron Eckhart", "Harvey Dent", 0], [11, "Brendan Gleeson", "Ken", 0], [11, "Ralph Fiennes", "Harry", 0], [3, "James Franco", "Scott Smith", 0], [1, "Gary Oldman", "James Gordon", 0], [0, "Anil Kapoor", "Prem Kumar", 0], [10, "Jeff Bridges", "Obadiah Stane", 0]],
    supporting_actress: [[14, "Penélope Cruz", "María Elena", 100], [8, "Amy Adams", "Sister James", 60], [8, "Viola Davis", "Mrs. Miller", 60], [2, "Taraji P. Henson", "Queenie", 60], [7, "Marisa Tomei", "Cassidy", 60], [12, "Rosemarie DeWitt", "Rachel", 0], [12, "Debra Winger", "Abby", 0], [7, "Evan Rachel Wood", "Stephanie", 0], [2, "Tilda Swinton", "Elizabeth Abbott", 0], [15, "Kathy Bates", "Helen Givings", 0], [11, "Clémence Poésy", "Chloë", 0], [13, "Amy Ryan", "Carol Dexter", 0]],
  },
};

export const FIXTURE_YEARS: FixtureYear[] = [y1939, y1975, y1994, y2008];

/* ---- Deterministic fake metrics ------------------------------------- */

/** Small string hash → 0..1, so fabricated numbers are stable across runs. */
function unitHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Percentile rank (0-100) of `value` among `all`, matching docs/GAME_DESIGN.md. */
function percentile(value: number, all: number[]): number {
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  return Math.round(((below + 0.5 * equal) / all.length) * 100);
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** A fully unmasked contender plus the hidden Academy outcome. */
export interface FixtureContender {
  contender: Contender;
  academy: 0 | 60 | 100;
}

/** Expand a fixture year into unmasked contender objects with metrics. */
export function buildYear(fixture: FixtureYear): FixtureContender[] {
  const ratings = fixture.films.map((f) => f.rating);
  const votes = fixture.films.map((f) => f.votesK);
  const revenues = fixture.films.filter((f) => f.revenueM !== null).map((f) => f.revenueM as number);

  const out: FixtureContender[] = [];
  for (const category of Object.keys(fixture.contenders) as Category[]) {
    for (const [filmIdx, person, character, academy] of fixture.contenders[category]) {
      const film = fixture.films[filmIdx];
      const personId = person ? `nm${(unitHash(person) * 9_000_000 + 1_000_000).toFixed(0)}` : null;
      const contenderId = person ? `${category}:${personId}:${film.id}` : `${category}:${film.id}`;

      // Prestige is "what the ranker thinks": correlated with the outcome plus
      // noise, so it is informative but not a giveaway.
      const noise = unitHash(contenderId) * 40 - 20;
      const prestige = clamp(Math.round(academy * 0.6 + 25 + noise));

      const metrics: ContenderMetrics = {
        acclaim: percentile(film.rating, ratings),
        popularity: percentile(film.votesK, votes),
        // Box office falls back to popularity when revenue is unknown (docs/GAME_DESIGN.md).
        box_office: film.revenueM === null ? percentile(film.votesK, votes) : percentile(film.revenueM, revenues),
        prestige,
      };
      const hasCritics = unitHash(film.id) > 0.3;
      const stats: ContenderStats = {
        imdb_rating: film.rating,
        imdb_votes: film.votesK * 1000,
        box_office_usd: film.revenueM === null ? null : film.revenueM * 1_000_000,
        rt_critic: hasCritics ? clamp(Math.round(film.rating * 11 + unitHash(film.id + "rt") * 10 - 5)) : null,
        rt_audience: hasCritics ? clamp(Math.round(film.rating * 10.5 + unitHash(film.id + "au") * 8 - 4)) : null,
        metascore: hasCritics ? clamp(Math.round(film.rating * 10 + unitHash(film.id + "mc") * 12 - 6)) : null,
      };

      out.push({
        academy,
        contender: {
          contender_id: contenderId,
          category,
          year: fixture.year,
          film_id: film.id,
          film_title: film.title,
          person_id: personId,
          person_name: person,
          character,
          genres: film.genres,
          runtime_minutes: film.runtime,
          archetype: film.archetype,
          metrics,
          stats,
        },
      });
    }
  }
  return out;
}
