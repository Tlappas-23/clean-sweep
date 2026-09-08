// Hand-written fixture catalog for the mock API adapter (src/api/mock.ts).
//
// Six film years, one per era, with roughly ten contenders per category.
// Titles and people are recognisable so the game feels real, but every
// number (ratings, votes, revenue, metrics) is a plausible fabrication. The
// real catalog comes from the data pipeline (docs/DATA.md). The
// `academy` column (100 win / 60 nomination / 0) is the row's own result in
// its category, and it is what feeds the ceremony metric and the Winner /
// Nominated badges on Browse.
//
// Six years matter: a round deals three *distinct* ones (docs/GAME_DESIGN.md
// §2) and the reroll then has to be able to find a fourth, so the fixture
// needs comfortably more years than a single round consumes, and one in each
// of six different decades, because the year reel draws a decade first.
//
// `revenueM` is *measured* revenue and is null for a good share of the older
// films, exactly as in the real catalog. Those gaps are filled with an
// estimate (`box_office_est_usd`) rather than left blank, and the two travel
// in separate fields so a card can never present a guess as a measurement.
// A couple of the thinnest films get neither, which keeps the "no figure at
// all" rendering on screen in mock mode.
//
// Every year also carries a `horror` and a `comedy` pool. Those two slots are
// not Academy Awards: the 100 goes to the year's genre crown and the 60s to
// its four runners-up, which is why a year like 1939 can be unwinnable for
// Best Supporting Actress and still perfectly playable for Best Horror.

import { isGenreCategory } from "../lib/labels";
import type {
  Category,
  Contender,
  ContenderCareer,
  ContenderMetrics,
  ContenderStats,
} from "./types";

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
    // Films 14+ exist for the genre slots. Rows index into this array by
    // position, so new films are always appended, never inserted.
    { id: "tt0031951", title: "Son of Frankenstein", rating: 7.1, votesK: 20, revenueM: null, runtime: 99, genres: ["Horror", "Sci-Fi"], archetype: "Genre Picture" },
    { id: "tt0031505", title: "The Hound of the Baskervilles", rating: 7.6, votesK: 10, revenueM: null, runtime: 80, genres: ["Crime", "Horror", "Mystery"], archetype: "Genre Picture" },
    { id: "tt0031117", title: "The Cat and the Canary", rating: 7.0, votesK: 5, revenueM: null, runtime: 72, genres: ["Comedy", "Horror", "Mystery"], archetype: "Cult Favourite" },
    { id: "tt0031455", title: "The Hunchback of Notre Dame", rating: 7.8, votesK: 16, revenueM: 3, runtime: 117, genres: ["Drama", "Horror", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0031042", title: "Bachelor Mother", rating: 7.4, votesK: 4, revenueM: 1, runtime: 82, genres: ["Comedy", "Romance"], archetype: "Crowd-Pleaser" },
    { id: "tt0031225", title: "Destry Rides Again", rating: 7.6, votesK: 12, revenueM: 2, runtime: 94, genres: ["Comedy", "Romance", "Western"], archetype: "Crowd-Pleaser" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [1, null, null, 60], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 60], [6, null, null, 60], [7, null, null, 60], [8, null, null, 60], [9, null, null, 60], [10, null, null, 0], [11, null, null, 0], [12, null, null, 0]],
    director: [[0, "Victor Fleming", null, 100], [2, "Frank Capra", null, 60], [3, "John Ford", null, 60], [4, "William Wyler", null, 60], [6, "Sam Wood", null, 60], [5, "Ernst Lubitsch", null, 0], [10, "Howard Hawks", null, 0], [11, "George Cukor", null, 0], [7, "Edmund Goulding", null, 0], [8, "Lewis Milestone", null, 0], [13, "John Ford", null, 0]],
    actor: [[6, "Robert Donat", "Mr. Chipping", 100], [0, "Clark Gable", "Rhett Butler", 60], [2, "James Stewart", "Jefferson Smith", 60], [4, "Laurence Olivier", "Heathcliff", 60], [10, "Cary Grant", "Geoff Carter", 0], [3, "John Wayne", "The Ringo Kid", 0], [5, "Melvyn Douglas", "Count Leon d'Algout", 0], [8, "Burgess Meredith", "George Milton", 0], [9, "Charles Boyer", "Michel Marnet", 0], [13, "Henry Fonda", "Abraham Lincoln", 0], [12, "Cary Grant", "Sgt. Cutter", 0]],
    actress: [[0, "Vivien Leigh", "Scarlett O'Hara", 100], [7, "Bette Davis", "Judith Traherne", 60], [5, "Greta Garbo", "Ninotchka", 60], [9, "Irene Dunne", "Terry McKay", 60], [6, "Greer Garson", "Katherine Chipping", 60], [1, "Judy Garland", "Dorothy Gale", 0], [4, "Merle Oberon", "Cathy", 0], [2, "Jean Arthur", "Clarissa Saunders", 0], [3, "Claire Trevor", "Dallas", 0], [11, "Norma Shearer", "Mary Haines", 0], [10, "Jean Arthur", "Bonnie Lee", 0]],
    supporting_actor: [[3, "Thomas Mitchell", "Doc Boone", 100], [2, "Claude Rains", "Senator Joseph Paine", 60], [2, "Harry Carey", "President of the Senate", 60], [0, "Leslie Howard", "Ashley Wilkes", 0], [1, "Frank Morgan", "The Wizard", 0], [1, "Ray Bolger", "The Scarecrow", 0], [8, "Lon Chaney Jr.", "Lennie Small", 0], [10, "Richard Barthelmess", "Bat MacPherson", 0], [3, "Andy Devine", "Buck", 0], [12, "Victor McLaglen", "Sgt. MacChesney", 0], [0, "Thomas Mitchell", "Gerald O'Hara", 0]],
    supporting_actress: [[0, "Hattie McDaniel", "Mammy", 100], [0, "Olivia de Havilland", "Melanie Hamilton", 60], [4, "Geraldine Fitzgerald", "Isabella Linton", 60], [9, "Maria Ouspenskaya", "Grandmother Janou", 60], [1, "Margaret Hamilton", "The Wicked Witch of the West", 0], [5, "Ina Claire", "Grand Duchess Swana", 0], [11, "Joan Crawford", "Crystal Allen", 0], [11, "Rosalind Russell", "Sylvia Fowler", 0], [1, "Billie Burke", "Glinda", 0], [4, "Flora Robson", "Ellen Dean", 0]],
    // Genre crowns: 17 The Hunchback of Notre Dame, 5 Ninotchka.
    horror: [[17, null, null, 100], [15, null, null, 60], [14, null, null, 60], [16, null, null, 60]],
    comedy: [[5, null, null, 100], [2, null, null, 60], [19, null, null, 60], [11, null, null, 60], [18, null, null, 60], [12, null, null, 0], [16, null, null, 0], [9, null, null, 0]],
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
    { id: "tt0073582", title: "Deep Red", rating: 7.5, votesK: 40, revenueM: null, runtime: 127, genres: ["Horror", "Mystery", "Thriller"], archetype: "Cult Favourite" },
    { id: "tt0073705", title: "Shivers", rating: 6.2, votesK: 15, revenueM: null, runtime: 87, genres: ["Horror", "Sci-Fi"], archetype: "Cult Favourite" },
    { id: "tt0073607", title: "Race with the Devil", rating: 6.5, votesK: 8, revenueM: 12, runtime: 88, genres: ["Action", "Horror", "Thriller"], archetype: "Genre Picture" },
    { id: "tt0072913", title: "The Devil's Rain", rating: 4.9, votesK: 5, revenueM: null, runtime: 86, genres: ["Horror"], archetype: "Genre Picture" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [1, null, null, 60], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 0], [6, null, null, 0], [7, null, null, 0], [8, null, null, 0], [9, null, null, 0], [11, null, null, 0]],
    director: [[0, "Milos Forman", null, 100], [2, "Sidney Lumet", null, 60], [3, "Robert Altman", null, 60], [4, "Stanley Kubrick", null, 60], [1, "Steven Spielberg", null, 0], [8, "John Huston", null, 0], [9, "Hal Ashby", null, 0], [7, "Sydney Pollack", null, 0], [5, "Terry Gilliam", null, 0], [11, "Woody Allen", null, 0], [12, "Ken Russell", null, 0]],
    actor: [[0, "Jack Nicholson", "R.P. McMurphy", 100], [2, "Al Pacino", "Sonny Wortzik", 60], [10, "Walter Matthau", "Willy Clark", 60], [1, "Roy Scheider", "Chief Martin Brody", 0], [8, "Sean Connery", "Daniel Dravot", 0], [4, "Ryan O'Neal", "Redmond Barry", 0], [7, "Robert Redford", "Joe Turner", 0], [9, "Warren Beatty", "George Roundy", 0], [5, "Graham Chapman", "King Arthur", 0], [6, "Tim Curry", "Dr. Frank-N-Furter", 0], [11, "Woody Allen", "Boris Grushenko", 0]],
    actress: [[0, "Louise Fletcher", "Nurse Ratched", 100], [12, "Ann-Margret", "Nora Walker", 60], [11, "Diane Keaton", "Sonja", 0], [7, "Faye Dunaway", "Kathy Hale", 0], [9, "Julie Christie", "Jackie Shawn", 0], [6, "Susan Sarandon", "Janet Weiss", 0], [4, "Marisa Berenson", "Lady Lyndon", 0], [1, "Lorraine Gary", "Ellen Brody", 0], [3, "Karen Black", "Connie White", 0], [9, "Goldie Hawn", "Jill Haynes", 0]],
    supporting_actor: [[10, "George Burns", "Al Lewis", 100], [0, "Brad Dourif", "Billy Bibbit", 60], [2, "Chris Sarandon", "Leon Shermer", 60], [9, "Jack Warden", "Lester Karpf", 60], [1, "Robert Shaw", "Quint", 0], [1, "Richard Dreyfuss", "Matt Hooper", 0], [8, "Michael Caine", "Peachy Carnehan", 0], [2, "John Cazale", "Sal", 0], [3, "Henry Gibson", "Haven Hamilton", 0], [4, "Patrick Magee", "The Chevalier", 0], [0, "Will Sampson", "Chief Bromden", 0]],
    supporting_actress: [[9, "Lee Grant", "Felicia Karpf", 100], [3, "Ronee Blakley", "Barbara Jean", 60], [3, "Lily Tomlin", "Linnea Reese", 60], [3, "Geraldine Chaplin", "Opal", 0], [3, "Barbara Harris", "Albuquerque", 0], [6, "Nell Campbell", "Columbia", 0], [12, "Tina Turner", "The Acid Queen", 0], [0, "Louise Fletcher", "Nurse Ratched", 0], [2, "Penelope Allen", "Sylvia", 0], [4, "Marie Kean", "Barry's Mother", 0]],
    // Genre crowns: 13 Deep Red, 5 Monty Python and the Holy Grail.
    horror: [[13, null, null, 100], [6, null, null, 60], [15, null, null, 60], [14, null, null, 60], [16, null, null, 0]],
    comedy: [[5, null, null, 100], [11, null, null, 60], [10, null, null, 60], [3, null, null, 60], [9, null, null, 60], [6, null, null, 0]],
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
    { id: "tt0111686", title: "Wes Craven's New Nightmare", rating: 6.4, votesK: 40, revenueM: 19, runtime: 112, genres: ["Horror", "Mystery", "Thriller"], archetype: "Genre Picture" },
    { id: "tt0113409", title: "In the Mouth of Madness", rating: 7.2, votesK: 70, revenueM: 9, runtime: 95, genres: ["Horror", "Mystery", "Thriller"], archetype: "Cult Favourite" },
    { id: "tt0109951", title: "Cemetery Man", rating: 7.1, votesK: 25, revenueM: null, runtime: 105, genres: ["Comedy", "Fantasy", "Horror"], archetype: "Cult Favourite" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [1, null, null, 60], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 0], [6, null, null, 0], [8, null, null, 0], [9, null, null, 0], [13, null, null, 0], [14, null, null, 0], [7, null, null, 0], [17, null, null, 0]],
    director: [[0, "Robert Zemeckis", null, 100], [1, "Quentin Tarantino", null, 60], [3, "Robert Redford", null, 60], [7, "Woody Allen", null, 60], [17, "Krzysztof Kieslowski", null, 60], [2, "Frank Darabont", null, 0], [6, "Tim Burton", null, 0], [9, "Peter Jackson", null, 0], [13, "Luc Besson", null, 0], [14, "Kevin Smith", null, 0], [15, "James Cameron", null, 0], [8, "Jan de Bont", null, 0]],
    actor: [[0, "Tom Hanks", "Forrest Gump", 100], [2, "Morgan Freeman", "Ellis Boyd 'Red' Redding", 60], [1, "John Travolta", "Vincent Vega", 60], [10, "Paul Newman", "Donald 'Sully' Sullivan", 60], [18, "Nigel Hawthorne", "King George III", 60], [2, "Tim Robbins", "Andy Dufresne", 0], [6, "Johnny Depp", "Ed Wood", 0], [4, "Hugh Grant", "Charles", 0], [8, "Keanu Reeves", "Jack Traven", 0], [3, "Ralph Fiennes", "Charles Van Doren", 0], [13, "Jean Reno", "Léon", 0], [16, "Tom Cruise", "Lestat", 0]],
    actress: [[11, "Jessica Lange", "Carly Marshall", 100], [19, "Jodie Foster", "Nell Kellty", 60], [12, "Winona Ryder", "Jo March", 60], [4, "Andie MacDowell", "Carrie", 0], [8, "Sandra Bullock", "Annie Porter", 0], [9, "Kate Winslet", "Juliet Hulme", 0], [9, "Melanie Lynskey", "Pauline Parker", 0], [13, "Natalie Portman", "Mathilda", 0], [15, "Jamie Lee Curtis", "Helen Tasker", 0], [0, "Robin Wright", "Jenny Curran", 0], [17, "Irène Jacob", "Valentine", 0]],
    supporting_actor: [[6, "Martin Landau", "Bela Lugosi", 100], [1, "Samuel L. Jackson", "Jules Winnfield", 60], [0, "Gary Sinise", "Lt. Dan Taylor", 60], [3, "Paul Scofield", "Mark Van Doren", 60], [7, "Chazz Palminteri", "Cheech", 60], [8, "Dennis Hopper", "Howard Payne", 0], [13, "Gary Oldman", "Norman Stansfield", 0], [1, "Bruce Willis", "Butch Coolidge", 0], [3, "John Turturro", "Herb Stempel", 0], [2, "Bob Gunton", "Warden Norton", 0], [5, "Jeremy Irons", "Scar", 0], [16, "Brad Pitt", "Louis", 0]],
    supporting_actress: [[7, "Dianne Wiest", "Helen Sinclair", 100], [1, "Uma Thurman", "Mia Wallace", 60], [18, "Helen Mirren", "Queen Charlotte", 60], [7, "Jennifer Tilly", "Olive Neal", 60], [0, "Sally Field", "Mrs. Gump", 0], [16, "Kirsten Dunst", "Claudia", 0], [4, "Kristin Scott Thomas", "Fiona", 0], [6, "Sarah Jessica Parker", "Dolores Fuller", 0], [6, "Patricia Arquette", "Kathy O'Hara", 0], [12, "Claire Danes", "Beth March", 0], [12, "Kirsten Dunst", "Young Amy March", 0]],
    // Genre crowns: 16 Interview with the Vampire, 6 Ed Wood.
    horror: [[16, null, null, 100], [21, null, null, 60], [22, null, null, 60], [20, null, null, 60]],
    comedy: [[6, null, null, 100], [14, null, null, 60], [4, null, null, 60], [7, null, null, 60], [18, null, null, 60], [10, null, null, 0], [22, null, null, 0], [15, null, null, 0]],
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
    { id: "tt1139797", title: "Let the Right One In", rating: 7.9, votesK: 220, revenueM: 11, runtime: 114, genres: ["Drama", "Fantasy", "Horror"], archetype: "Critical Darling" },
    { id: "tt0482606", title: "The Strangers", rating: 6.2, votesK: 130, revenueM: 82, runtime: 86, genres: ["Horror", "Thriller"], archetype: "Genre Picture" },
    { id: "tt1060277", title: "Cloverfield", rating: 7.0, votesK: 400, revenueM: 172, runtime: 85, genres: ["Action", "Horror", "Sci-Fi"], archetype: "Blockbuster" },
    { id: "tt1029234", title: "Martyrs", rating: 7.0, votesK: 70, revenueM: null, runtime: 99, genres: ["Horror"], archetype: "Cult Favourite" },
    { id: "tt0887883", title: "Burn After Reading", rating: 7.0, votesK: 300, revenueM: 163, runtime: 96, genres: ["Comedy", "Crime", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0430922", title: "Role Models", rating: 6.9, votesK: 190, revenueM: 92, runtime: 99, genres: ["Comedy"], archetype: "Crowd-Pleaser" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [2, null, null, 60], [3, null, null, 60], [4, null, null, 60], [5, null, null, 60], [1, null, null, 0], [6, null, null, 0], [7, null, null, 0], [8, null, null, 0], [9, null, null, 0], [10, null, null, 0], [11, null, null, 0]],
    director: [[0, "Danny Boyle", null, 100], [2, "David Fincher", null, 60], [3, "Gus Van Sant", null, 60], [4, "Ron Howard", null, 60], [5, "Stephen Daldry", null, 60], [1, "Christopher Nolan", null, 0], [7, "Darren Aronofsky", null, 0], [6, "Andrew Stanton", null, 0], [9, "Clint Eastwood", null, 0], [10, "Jon Favreau", null, 0], [11, "Martin McDonagh", null, 0], [12, "Jonathan Demme", null, 0]],
    actor: [[3, "Sean Penn", "Harvey Milk", 100], [7, "Mickey Rourke", "Randy 'The Ram' Robinson", 60], [4, "Frank Langella", "Richard Nixon", 60], [2, "Brad Pitt", "Benjamin Button", 60], [17, "Richard Jenkins", "Walter Vale", 60], [1, "Christian Bale", "Bruce Wayne", 0], [9, "Clint Eastwood", "Walt Kowalski", 0], [10, "Robert Downey Jr.", "Tony Stark", 0], [11, "Colin Farrell", "Ray", 0], [0, "Dev Patel", "Jamal Malik", 0], [15, "Leonardo DiCaprio", "Frank Wheeler", 0], [4, "Michael Sheen", "David Frost", 0]],
    actress: [[5, "Kate Winslet", "Hanna Schmitz", 100], [12, "Anne Hathaway", "Kym", 60], [13, "Angelina Jolie", "Christine Collins", 60], [18, "Melissa Leo", "Ray Eddy", 60], [8, "Meryl Streep", "Sister Aloysius", 60], [2, "Cate Blanchett", "Daisy", 0], [14, "Rebecca Hall", "Vicky", 0], [14, "Scarlett Johansson", "Cristina", 0], [0, "Freida Pinto", "Latika", 0], [1, "Maggie Gyllenhaal", "Rachel Dawes", 0], [15, "Kate Winslet", "April Wheeler", 0], [10, "Gwyneth Paltrow", "Pepper Potts", 0]],
    supporting_actor: [[1, "Heath Ledger", "The Joker", 100], [3, "Josh Brolin", "Dan White", 60], [16, "Robert Downey Jr.", "Kirk Lazarus", 60], [8, "Philip Seymour Hoffman", "Father Flynn", 60], [15, "Michael Shannon", "John Givings", 60], [1, "Aaron Eckhart", "Harvey Dent", 0], [11, "Brendan Gleeson", "Ken", 0], [11, "Ralph Fiennes", "Harry", 0], [3, "James Franco", "Scott Smith", 0], [1, "Gary Oldman", "James Gordon", 0], [0, "Anil Kapoor", "Prem Kumar", 0], [10, "Jeff Bridges", "Obadiah Stane", 0]],
    supporting_actress: [[14, "Penélope Cruz", "María Elena", 100], [8, "Amy Adams", "Sister James", 60], [8, "Viola Davis", "Mrs. Miller", 60], [2, "Taraji P. Henson", "Queenie", 60], [7, "Marisa Tomei", "Cassidy", 60], [12, "Rosemarie DeWitt", "Rachel", 0], [12, "Debra Winger", "Abby", 0], [7, "Evan Rachel Wood", "Stephanie", 0], [2, "Tilda Swinton", "Elizabeth Abbott", 0], [15, "Kathy Bates", "Helen Givings", 0], [11, "Clémence Poésy", "Chloë", 0], [13, "Amy Ryan", "Carol Dexter", 0]],
    // Genre crowns: 19 Let the Right One In, 11 In Bruges.
    horror: [[19, null, null, 100], [21, null, null, 60], [22, null, null, 60], [20, null, null, 60]],
    comedy: [[11, null, null, 100], [16, null, null, 60], [23, null, null, 60], [14, null, null, 60], [24, null, null, 60]],
  },
};

// ---------------------------------------------------------------- 1960 ----
const y1960: FixtureYear = {
  year: 1960,
  films: [
    { id: "tt0053604", title: "The Apartment", rating: 8.3, votesK: 190, revenueM: 25, runtime: 125, genres: ["Comedy", "Drama", "Romance"], archetype: "Critical Darling" },
    { id: "tt0054215", title: "Psycho", rating: 8.5, votesK: 720, revenueM: 50, runtime: 109, genres: ["Horror", "Mystery", "Thriller"], archetype: "Genre Picture" },
    { id: "tt0054331", title: "Spartacus", rating: 7.9, votesK: 140, revenueM: 60, runtime: 197, genres: ["Adventure", "Biography", "Drama"], archetype: "Blockbuster" },
    { id: "tt0053793", title: "Elmer Gantry", rating: 7.6, votesK: 12, revenueM: 6, runtime: 146, genres: ["Drama"], archetype: "Prestige Drama" },
    { id: "tt0054328", title: "Sons and Lovers", rating: 7.0, votesK: 3, revenueM: null, runtime: 103, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0054377", title: "The Sundowners", rating: 6.9, votesK: 3, revenueM: null, runtime: 133, genres: ["Drama", "Western"], archetype: "Prestige Drama" },
    { id: "tt0053699", title: "BUtterfield 8", rating: 6.3, votesK: 8, revenueM: 18, runtime: 109, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0053946", title: "Inherit the Wind", rating: 8.1, votesK: 33, revenueM: 2, runtime: 128, genres: ["Biography", "Drama", "History"], archetype: "Critical Darling" },
    { id: "tt0053779", title: "La Dolce Vita", rating: 8.0, votesK: 80, revenueM: 20, runtime: 174, genres: ["Comedy", "Drama"], archetype: "Critical Darling" },
    { id: "tt0054167", title: "Peeping Tom", rating: 7.6, votesK: 40, revenueM: null, runtime: 101, genres: ["Drama", "Horror", "Thriller"], archetype: "Cult Favourite" },
    { id: "tt0053459", title: "Eyes Without a Face", rating: 7.6, votesK: 40, revenueM: null, runtime: 90, genres: ["Drama", "Horror"], archetype: "Cult Favourite" },
    { id: "tt0054443", title: "Village of the Damned", rating: 7.1, votesK: 15, revenueM: null, runtime: 77, genres: ["Horror", "Sci-Fi"], archetype: "Genre Picture" },
    { id: "tt0054047", title: "The Magnificent Seven", rating: 7.7, votesK: 110, revenueM: 4, runtime: 128, genres: ["Action", "Adventure", "Western"], archetype: "Crowd-Pleaser" },
    { id: "tt0054135", title: "Ocean's Eleven", rating: 6.6, votesK: 25, revenueM: 5, runtime: 127, genres: ["Comedy", "Crime", "Thriller"], archetype: "Cult Favourite" },
    { id: "tt0053925", title: "House of Usher", rating: 6.9, votesK: 8, revenueM: null, runtime: 79, genres: ["Horror"], archetype: "Genre Picture" },
    { id: "tt0054387", title: "The Time Machine", rating: 7.6, votesK: 40, revenueM: 3, runtime: 103, genres: ["Adventure", "Sci-Fi"], archetype: "Crowd-Pleaser" },
    { id: "tt0053874", title: "The Grass Is Greener", rating: 6.4, votesK: 5, revenueM: null, runtime: 104, genres: ["Comedy", "Romance"], archetype: "Crowd-Pleaser" },
    { id: "tt0054110", title: "Never on Sunday", rating: 7.1, votesK: 6, revenueM: null, runtime: 91, genres: ["Comedy", "Drama", "Romance"], archetype: "Critical Darling" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [3, null, null, 60], [4, null, null, 60], [5, null, null, 60], [2, null, null, 0], [7, null, null, 0], [12, null, null, 0], [1, null, null, 0], [8, null, null, 0], [13, null, null, 0], [15, null, null, 0]],
    director: [[0, "Billy Wilder", null, 100], [1, "Alfred Hitchcock", null, 60], [4, "Jack Cardiff", null, 60], [5, "Fred Zinnemann", null, 60], [2, "Stanley Kubrick", null, 0], [7, "Stanley Kramer", null, 0], [8, "Federico Fellini", null, 0], [12, "John Sturges", null, 0], [9, "Michael Powell", null, 0], [13, "Lewis Milestone", null, 0]],
    actor: [[3, "Burt Lancaster", "Elmer Gantry", 100], [0, "Jack Lemmon", "C.C. Baxter", 60], [4, "Trevor Howard", "Walter Morel", 60], [7, "Spencer Tracy", "Henry Drummond", 60], [2, "Kirk Douglas", "Spartacus", 0], [1, "Anthony Perkins", "Norman Bates", 0], [12, "Yul Brynner", "Chris Adams", 0], [8, "Marcello Mastroianni", "Marcello Rubini", 0], [9, "Karlheinz Böhm", "Mark Lewis", 0], [13, "Frank Sinatra", "Danny Ocean", 0]],
    actress: [[6, "Elizabeth Taylor", "Gloria Wandrous", 100], [0, "Shirley MacLaine", "Fran Kubelik", 60], [5, "Deborah Kerr", "Ida Carmody", 60], [17, "Melina Mercouri", "Ilya", 60], [1, "Janet Leigh", "Marion Crane", 0], [3, "Jean Simmons", "Sister Sharon Falconer", 0], [4, "Wendy Hiller", "Mrs. Morel", 0], [8, "Anita Ekberg", "Sylvia", 0], [10, "Edith Scob", "Christiane Génessier", 0], [7, "Florence Eldridge", "Sarah Brady", 0]],
    supporting_actor: [[2, "Peter Ustinov", "Lentulus Batiatus", 100], [0, "Jack Kruschen", "Dr. Dreyfuss", 60], [3, "Arthur Kennedy", "Jim Lefferts", 60], [2, "Charles Laughton", "Sempronius Gracchus", 0], [7, "Gene Kelly", "E.K. Hornbeck", 0], [12, "Eli Wallach", "Calvera", 0], [12, "Steve McQueen", "Vin Tanner", 0], [1, "Martin Balsam", "Milton Arbogast", 0], [8, "Alain Cuny", "Steiner", 0], [15, "Alan Young", "David Filby", 0]],
    supporting_actress: [[3, "Shirley Jones", "Lulu Bains", 100], [1, "Janet Leigh", "Marion Crane", 60], [5, "Glynis Johns", "Mrs. Firth", 60], [4, "Mary Ure", "Clara Dawes", 60], [0, "Hope Holiday", "Margie MacDougall", 0], [6, "Dina Merrill", "Emily Liggett", 0], [8, "Anouk Aimée", "Maddalena", 0], [2, "Jean Simmons", "Varinia", 0], [7, "Donna Anderson", "Rachel Brown", 0], [16, "Jean Simmons", "Hilary Rhyall", 0]],
    // Genre crowns: 1 Psycho, 0 The Apartment, the two docs/GAME_DESIGN.md
    // names as the sanity check that the crown lands where you would hope.
    horror: [[1, null, null, 100], [9, null, null, 60], [10, null, null, 60], [11, null, null, 60], [14, null, null, 0]],
    comedy: [[0, null, null, 100], [8, null, null, 60], [17, null, null, 60], [13, null, null, 60], [16, null, null, 0]],
  },
};

// ---------------------------------------------------------------- 1986 ----
const y1986: FixtureYear = {
  year: 1986,
  films: [
    { id: "tt0091763", title: "Platoon", rating: 8.1, votesK: 430, revenueM: 139, runtime: 120, genres: ["Drama", "War"], archetype: "Prestige Drama" },
    { id: "tt0090605", title: "Aliens", rating: 8.4, votesK: 750, revenueM: 131, runtime: 137, genres: ["Action", "Adventure", "Sci-Fi"], archetype: "Blockbuster" },
    { id: "tt0091167", title: "Hannah and Her Sisters", rating: 7.9, votesK: 70, revenueM: 40, runtime: 107, genres: ["Comedy", "Drama"], archetype: "Critical Darling" },
    { id: "tt0091867", title: "A Room with a View", rating: 7.3, votesK: 35, revenueM: 21, runtime: 117, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0090830", title: "Children of a Lesser God", rating: 7.0, votesK: 12, revenueM: 32, runtime: 119, genres: ["Drama", "Romance"], archetype: "Prestige Drama" },
    { id: "tt0091530", title: "The Mission", rating: 7.4, votesK: 60, revenueM: 17, runtime: 126, genres: ["Adventure", "Drama", "History"], archetype: "Prestige Drama" },
    { id: "tt0091064", title: "The Fly", rating: 7.6, votesK: 200, revenueM: 60, runtime: 96, genres: ["Drama", "Horror", "Sci-Fi"], archetype: "Genre Picture" },
    { id: "tt0090756", title: "Blue Velvet", rating: 7.7, votesK: 210, revenueM: 8, runtime: 120, genres: ["Drama", "Mystery", "Thriller"], archetype: "Cult Favourite" },
    { id: "tt0091042", title: "Ferris Bueller's Day Off", rating: 7.8, votesK: 380, revenueM: 70, runtime: 103, genres: ["Comedy"], archetype: "Crowd-Pleaser" },
    { id: "tt0092005", title: "Stand by Me", rating: 8.1, votesK: 420, revenueM: 52, runtime: 89, genres: ["Adventure", "Drama"], archetype: "Crowd-Pleaser" },
    { id: "tt0092099", title: "Top Gun", rating: 6.9, votesK: 420, revenueM: 357, runtime: 110, genres: ["Action", "Drama"], archetype: "Blockbuster" },
    { id: "tt0090839", title: "Crimes of the Heart", rating: 6.4, votesK: 5, revenueM: 22, runtime: 105, genres: ["Comedy", "Drama"], archetype: "Prestige Drama" },
    { id: "tt0090863", title: "The Color of Money", rating: 7.0, votesK: 90, revenueM: 52, runtime: 119, genres: ["Drama", "Sport"], archetype: "Prestige Drama" },
    { id: "tt0091738", title: "Peggy Sue Got Married", rating: 6.3, votesK: 30, revenueM: 41, runtime: 103, genres: ["Comedy", "Drama", "Fantasy"], archetype: "Crowd-Pleaser" },
    { id: "tt0099763", title: "Henry: Portrait of a Serial Killer", rating: 7.0, votesK: 30, revenueM: null, runtime: 83, genres: ["Crime", "Drama", "Horror"], archetype: "Cult Favourite" },
    { id: "tt0092076", title: "The Texas Chainsaw Massacre 2", rating: 5.7, votesK: 30, revenueM: 8, runtime: 101, genres: ["Comedy", "Horror"], archetype: "Cult Favourite" },
    { id: "tt0091630", title: "Night of the Creeps", rating: 7.0, votesK: 25, revenueM: null, runtime: 88, genres: ["Comedy", "Horror", "Sci-Fi"], archetype: "Cult Favourite" },
    { id: "tt0091419", title: "Little Shop of Horrors", rating: 6.9, votesK: 60, revenueM: 39, runtime: 94, genres: ["Comedy", "Horror", "Musical"], archetype: "Cult Favourite" },
    { id: "tt0090966", title: "Down and Out in Beverly Hills", rating: 6.2, votesK: 15, revenueM: 62, runtime: 103, genres: ["Comedy"], archetype: "Crowd-Pleaser" },
    { id: "tt0091983", title: "Something Wild", rating: 6.9, votesK: 20, revenueM: 9, runtime: 114, genres: ["Comedy", "Crime", "Drama"], archetype: "Cult Favourite" },
    { id: "tt0091891", title: "'Round Midnight", rating: 7.3, votesK: 5, revenueM: 3, runtime: 133, genres: ["Drama", "Music"], archetype: "Critical Darling" },
  ],
  contenders: {
    picture: [[0, null, null, 100], [4, null, null, 60], [2, null, null, 60], [5, null, null, 60], [3, null, null, 60], [1, null, null, 0], [8, null, null, 0], [9, null, null, 0], [10, null, null, 0], [7, null, null, 0], [12, null, null, 0]],
    director: [[0, "Oliver Stone", null, 100], [2, "Woody Allen", null, 60], [3, "James Ivory", null, 60], [5, "Roland Joffé", null, 60], [7, "David Lynch", null, 60], [1, "James Cameron", null, 0], [9, "Rob Reiner", null, 0], [10, "Tony Scott", null, 0], [6, "David Cronenberg", null, 0], [12, "Martin Scorsese", null, 0]],
    actor: [[12, "Paul Newman", "Fast Eddie Felson", 100], [20, "Dexter Gordon", "Dale Turner", 60], [4, "William Hurt", "James Leeds", 60], [0, "Charlie Sheen", "Chris Taylor", 0], [8, "Matthew Broderick", "Ferris Bueller", 0], [7, "Kyle MacLachlan", "Jeffrey Beaumont", 0], [6, "Jeff Goldblum", "Seth Brundle", 0], [10, "Tom Cruise", "Pete 'Maverick' Mitchell", 0], [2, "Michael Caine", "Elliot", 0], [5, "Robert De Niro", "Rodrigo Mendoza", 0]],
    actress: [[4, "Marlee Matlin", "Sarah Norman", 100], [11, "Sissy Spacek", "Babe Botrelle", 60], [13, "Kathleen Turner", "Peggy Sue Bodell", 60], [1, "Sigourney Weaver", "Ellen Ripley", 60], [3, "Helena Bonham Carter", "Lucy Honeychurch", 0], [2, "Mia Farrow", "Hannah", 0], [7, "Isabella Rossellini", "Dorothy Vallens", 0], [6, "Geena Davis", "Veronica Quaife", 0], [19, "Melanie Griffith", "Audrey Hankel", 0], [11, "Jessica Lange", "Meg Magrath", 0]],
    supporting_actor: [[2, "Michael Caine", "Elliot", 100], [0, "Tom Berenger", "Sgt. Barnes", 60], [0, "Willem Dafoe", "Sgt. Elias", 60], [3, "Denholm Elliott", "Mr. Emerson", 60], [7, "Dennis Hopper", "Frank Booth", 0], [1, "Bill Paxton", "Pvt. Hudson", 0], [9, "Kiefer Sutherland", "Ace Merrill", 0], [12, "Tom Cruise", "Vincent Lauria", 0], [5, "Jeremy Irons", "Father Gabriel", 0], [8, "Alan Ruck", "Cameron Frye", 0]],
    supporting_actress: [[2, "Dianne Wiest", "Holly", 100], [11, "Tess Harper", "Chick Boyle", 60], [4, "Piper Laurie", "Mrs. Norman", 60], [12, "Mary Elizabeth Mastrantonio", "Carmen", 60], [3, "Maggie Smith", "Charlotte Bartlett", 60], [2, "Barbara Hershey", "Lee", 0], [1, "Jenette Goldstein", "Pvt. Vasquez", 0], [13, "Joan Allen", "Maddy Nagle", 0], [7, "Laura Dern", "Sandy Williams", 0], [3, "Judi Dench", "Eleanor Lavish", 0]],
    // Genre crowns: 6 The Fly, 8 Ferris Bueller's Day Off.
    horror: [[6, null, null, 100], [14, null, null, 60], [17, null, null, 60], [16, null, null, 60], [15, null, null, 0]],
    comedy: [[8, null, null, 100], [2, null, null, 60], [17, null, null, 60], [19, null, null, 60], [13, null, null, 60], [18, null, null, 0], [16, null, null, 0], [11, null, null, 0]],
  },
};

/**
 * The fixture years, oldest first: one per decade so the mock's decade reel
 * has a genuine choice and a round can always deal three distinct years.
 */
export const FIXTURE_YEARS: FixtureYear[] = [y1939, y1960, y1975, y1986, y1994, y2008];

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

/**
 * Below this many thousand votes a film gets no revenue estimate at all.
 *
 * The real estimator leans on vote count to separate films inside a group, so
 * the thinnest rows are exactly the ones it should decline to guess about.
 * Keeping a couple of fixture films on the wrong side of this line is what
 * puts the "neither measured nor estimated" case, a bare dash, in front of
 * the card in mock mode, not only in a unit test.
 */
const MIN_VOTES_K_FOR_ESTIMATE = 6;

/**
 * A stand-in for `pipeline/boxoffice.py`'s ratio estimator.
 *
 * The real thing is
 *   log(revenue) = median log(revenue) of the film's group
 *                + BETA · (log(votes) − median log(votes) of the group)
 * where the group is the most specific of (year, genre) / (decade, genre) /
 * decade / catalog with enough measured films to trust. The mock uses the
 * fixture year as the group and the same shape, so the numbers it produces
 * behave like estimates: within an order of magnitude of the year's measured
 * films, and ordered by how widely a film is known.
 *
 * Returned in dollars, rounded to a whole million so it never reads with more
 * precision than an estimate has earned.
 */
function estimateRevenueUsd(film: FixtureFilm, known: FixtureFilm[]): number | null {
  if (film.revenueM !== null || film.votesK < MIN_VOTES_K_FOR_ESTIMATE) return null;
  if (known.length === 0) return null;
  const BETA = 0.75; // elasticity of log revenue to log votes, fitted offline
  const medianLogRevenue = median(known.map((f) => Math.log((f.revenueM as number) + 1)));
  const medianLogVotes = median(known.map((f) => Math.log(f.votesK + 1)));
  const logEstimate =
    medianLogRevenue + BETA * (Math.log(film.votesK + 1) - medianLogVotes);
  const millions = Math.max(1, Math.round(Math.exp(logEstimate) - 1));
  return millions * 1_000_000;
}

/** Median of a non-empty numeric list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ---- Fake posters ---------------------------------------------------- */

/**
 * The one film in the fixture deliberately left without a poster.
 *
 * The real catalog has a poster for every contender, but the card still has to
 * survive a null, so the mock keeps exactly one gap: run the app with
 * VITE_API_MOCK=true, draft 1939 Best Picture, and the fallback block is right
 * there on screen instead of only in a unit test.
 */
const POSTERLESS_FILM_ID = "tt0031593"; // Love Affair (1939)

/**
 * A stand-in for the TMDB `w342` poster the real API returns.
 *
 * The backend sends `https://image.tmdb.org/t/p/w342/…`; the mock cannot,
 * because it has no TMDB paths and is expected to work offline. It returns a
 * self-contained SVG data URI at the same 2:3 aspect ratio instead. Same
 * field, same shape, same layout behaviour, and the demo actually shows a
 * poster wall rather than a grid of broken images.
 */
function posterFor(film: FixtureFilm): string | null {
  if (film.id === POSTERLESS_FILM_ID) return null;
  // One hue per film, off its id, drawn from the whole circle rather than a
  // narrow band. These stand in for real poster art, which is every colour
  // there is, and a wall of varied posters is exactly what the cool chrome
  // in src/index.css exists to frame.
  const hue = Math.round(unitHash(film.id + "hue") * 360);
  const dark = `hsl(${hue} 26% 8%)`;
  const glow = `hsl(${hue} 60% 52%)`;
  const words = film.title.split(" ");
  // Break the title over up to three lines so long names stay readable.
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 14 && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  const text = shown
    .map((l, i) => `<tspan x="114" dy="${i === 0 ? 0 : 26}">${escapeXml(l)}</tspan>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="228" height="342" viewBox="0 0 228 342">
<rect width="228" height="342" fill="${dark}"/>
<circle cx="114" cy="120" r="86" fill="${glow}" opacity="0.22"/>
<rect x="10" y="10" width="208" height="322" fill="none" stroke="${glow}" stroke-opacity="0.5"/>
<text x="114" y="${190 - (shown.length - 1) * 13}" fill="#edf1f7" font-family="Georgia,serif" font-size="22" text-anchor="middle">${text}</text>
<text x="114" y="300" fill="${glow}" font-family="Georgia,serif" font-size="16" text-anchor="middle">${film.runtime} min</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Minimal XML escaping for titles with & or quotes in them. */
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&apos;",
  );
}

/* ---- Fake career records --------------------------------------------- */

/**
 * A person's record *before* this film year, fabricated but stable.
 *
 * Derived from the name alone, never from the row's `academy` value: the
 * career line is shown while drafting, so anything correlated with the answer
 * would hand the game away. Film categories (picture / horror / comedy) have
 * no person and get a zeroed record, exactly like the real API.
 */
function careerFor(person: string | null, category: Category): ContenderCareer {
  if (!person) return { prior_nominations: 0, prior_wins: 0, billing: null };
  const priorNominations = Math.floor(unitHash(person + "noms") * 5); // 0-4
  const priorWins = Math.min(
    priorNominations,
    Math.floor(unitHash(person + "wins") * (priorNominations + 1) * 0.6),
  );
  // Directors are not in the cast, so they have no billing. Leads sit at the
  // top of the call sheet; supporting players start a couple of names down.
  const isLead = category === "actor" || category === "actress";
  const billing =
    category === "director"
      ? null
      : isLead
        ? 1 + Math.floor(unitHash(person + "bill") * 2)
        : 2 + Math.floor(unitHash(person + "bill") * 4);
  return { prior_nominations: priorNominations, prior_wins: priorWins, billing };
}

/* ---- The ceremony metric ---------------------------------------------- */

// The mock's copy of backend/app/engine/scoring.py and backend/pipeline/
// awards.py. The published demo runs on this adapter, so a player reading the
// reveal here has to be reading the rule the real game applies. The four
// constants below are the backend's, not approximations of them.
//
// One thing is necessarily smaller than the real article. The seed holds
// every nomination in all 55 Academy categories; this fixture records only
// the six the game plays, so a mock film's standing is built from those. The
// rule is the same either way: a film the Academy honoured somewhere other
// than the slot on the board stops being scored as a zero.

/** What one award is worth. Every category the fixture records is above the line. */
const AWARD_WEIGHT = 4.0;
/** What a losing nomination is worth against a win in the same category. */
const LOSS_CREDIT = 0.4;
/** Weighted points at which a film reaches half the ceiling. */
const SATURATION = 8.0;
/** The most film standing can contribute. Below 60, so it never beats a nomination. */
const STANDING_CEILING = 50.0;

/**
 * Weighted Academy standing per film id, 0 to `STANDING_CEILING`.
 *
 * Deduplicated per (film, category): Gone with the Wind holds both of 1939's
 * Supporting Actress slots in the fixture, and counting that category twice
 * would say the Academy honoured the film twice for it. The genre pools are
 * skipped because the crown is not an Academy Award, so counting it would
 * invent a record the film does not have.
 *
 * The curve saturates rather than scaling, because the gap between no Oscars
 * and three is much larger than the gap between eight and eleven.
 */
function filmStanding(fixture: FixtureYear): Map<string, number> {
  const bestPerCategory = new Map<string, number>(); // "filmId|category" -> best result
  for (const category of Object.keys(fixture.contenders) as Category[]) {
    if (isGenreCategory(category)) continue;
    for (const [filmIdx, , , academy] of fixture.contenders[category]) {
      const key = `${fixture.films[filmIdx].id}|${category}`;
      bestPerCategory.set(key, Math.max(bestPerCategory.get(key) ?? 0, academy));
    }
  }

  const points = new Map<string, number>();
  for (const [key, academy] of bestPerCategory) {
    if (academy === 0) continue;
    const filmId = key.slice(0, key.indexOf("|"));
    const credit = academy === 100 ? 1 : LOSS_CREDIT;
    points.set(filmId, (points.get(filmId) ?? 0) + AWARD_WEIGHT * credit);
  }

  const standing = new Map<string, number>();
  for (const film of fixture.films) {
    const p = points.get(film.id) ?? 0;
    standing.set(film.id, (STANDING_CEILING * p) / (p + SATURATION));
  }
  return standing;
}

/**
 * The ceremony metric: the better of two readings of the same pick.
 *
 * A win in the category being played is 100 and a nomination in it is at
 * least 60 whatever the film did elsewhere, because standing is capped below
 * 60. Nothing a film achieved in another category outranks a real nomination
 * for the award on the board; it can only stop an un-nominated pick from
 * being scored as worthless.
 */
function ceremonyMetric(academy: 0 | 60 | 100, standing: number): number {
  if (academy === 100) return 100;
  return Math.max(academy, standing);
}

/* ---- Critics' columns -------------------------------------------------- */

/**
 * The three critics' columns for a film, and the number the Critics metric reads.
 *
 * Sparse on purpose: about a third of the fixture carries them, because the
 * real pipeline backfills Rotten Tomatoes and Metacritic against a daily API
 * quota and most films are still waiting their turn. `average` is null where
 * neither figure exists, which is the case the scorer has to renormalise
 * around, exactly as it does for a missing box-office figure.
 */
function criticColumns(film: FixtureFilm) {
  const has = unitHash(film.id) > 0.66;
  const rtCritic = has ? clamp(Math.round(film.rating * 11 + unitHash(film.id + "rt") * 10 - 5)) : null;
  const rtAudience = has ? clamp(Math.round(film.rating * 10.5 + unitHash(film.id + "au") * 8 - 4)) : null;
  const metascore = has ? clamp(Math.round(film.rating * 10 + unitHash(film.id + "mc") * 12 - 6)) : null;
  // The RT *critic* score and the Metascore, never the RT audience score:
  // that one asks the question the Audience metric already answers.
  const both = [rtCritic, metascore].filter((v): v is number => v !== null);
  const average = both.length === 0 ? null : both.reduce((a, b) => a + b, 0) / both.length;
  return { rtCritic, rtAudience, metascore, average };
}

/**
 * A fully unmasked contender, its own Academy result, and its ceremony score.
 *
 * `academy` and `ceremony` are different things and both are needed.
 * `academy` is the row's result in this category and drives the Winner /
 * Nominated wording and badges; `ceremony` is the 0-100 metric that result
 * feeds, which can land anywhere in the range.
 */
export interface FixtureContender {
  contender: Contender;
  academy: 0 | 60 | 100;
  ceremony: number;
}

/** Expand a fixture year into unmasked contender objects with metrics. */
export function buildYear(fixture: FixtureYear): FixtureContender[] {
  const ratings = fixture.films.map((f) => f.rating);
  const votes = fixture.films.map((f) => f.votesK);
  const measured = fixture.films.filter((f) => f.revenueM !== null);
  const revenues = measured.map((f) => f.revenueM as number);
  const standings = filmStanding(fixture);
  // Critics is percentiled over the films that *have* a critic figure, not
  // over the whole year. Ranking a film against the ones nobody scored would
  // reward it for the gap rather than for the reviews.
  const critics = new Map(fixture.films.map((f) => [f.id, criticColumns(f)]));
  const criticAverages = [...critics.values()]
    .map((c) => c.average)
    .filter((v): v is number => v !== null);

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

      const critic = critics.get(film.id)!;
      const metrics: ContenderMetrics = {
        audience: percentile(film.rating, ratings),
        // Null for most of the fixture, which is the point: the scorer has to
        // renormalise around it rather than read the gap as a bad review.
        critics: critic.average === null ? null : percentile(critic.average, criticAverages),
        popularity: percentile(film.votesK, votes),
        // Measured revenue only. A film with just an estimate scores null
        // here, which is why the card can show "≈$8M est." beside an empty
        // Box Office bar: an estimated percentile would be a near-duplicate
        // of Popularity (it is derived from vote count), and double-counting
        // one signal under two names is worse than leaving the gap.
        box_office: film.revenueM === null ? null : percentile(film.revenueM, revenues),
        prestige,
      };
      // Budget is known for about two films in three, and never without a
      // revenue figure to sit beside.
      const hasBudget = film.revenueM !== null && unitHash(film.id + "budget") > 0.33;
      const stats: ContenderStats = {
        imdb_rating: film.rating,
        imdb_votes: film.votesK * 1000,
        box_office_usd: film.revenueM === null ? null : film.revenueM * 1_000_000,
        // Two separate columns, never both set: a measured film has no
        // estimate, and an estimate only exists where nothing was measured.
        box_office_est_usd: estimateRevenueUsd(film, measured),
        budget_usd: hasBudget
          ? Math.round((film.revenueM as number) * (0.2 + unitHash(film.id + "b2") * 0.4)) * 1_000_000
          : null,
        rt_critic: critic.rtCritic,
        rt_audience: critic.rtAudience,
        metascore: critic.metascore,
      };

      out.push({
        academy,
        ceremony: ceremonyMetric(academy, standings.get(film.id) ?? 0),
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
          poster_url: posterFor(film),
          metrics,
          stats,
          career: careerFor(person, category),
        },
      });
    }
  }
  return out;
}
