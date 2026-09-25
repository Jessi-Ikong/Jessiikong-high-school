import { fetchAllNews } from '../../lib/publicSite'
import { useAsyncData } from '../../hooks/useAsyncData'
import { LoadError, Loading, NewsCard, PageHero } from '../../components/public/PublicBits'

// Public news & events: every published post, newest first. Each opens its
// own page (/news/<id>) so a single story can be shared as a link.
export default function News() {
  const query = useAsyncData(fetchAllNews, 'public-news')

  return (
    <>
      <PageHero eyebrow="What's happening" title="News & Events">
        Stories, achievements and upcoming events from around the school.
      </PageHero>
      <section className="pub-section">
        <div className="pub-wrap">
          {query.loading ? (
            <Loading />
          ) : query.error ? (
            <LoadError />
          ) : query.data.length === 0 ? (
            <p className="pub-empty">No news yet — check back soon.</p>
          ) : (
            <>
              <FeaturedPost post={query.data[0]} />
              {query.data.length > 1 && (
                <div className="pub-news-grid">
                  {query.data.slice(1).map((post) => (
                    <NewsCard key={post.id} post={post} headingLevel={2} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}

// The newest post, shown larger.
function FeaturedPost({ post }) {
  return (
    <div className="pub-featured">
      <NewsCard post={post} headingLevel={2} />
    </div>
  )
}
