import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchNewsPost } from '../../lib/publicSite'
import { galleryUrl } from '../../lib/publicContent'
import { formatLongDate, toParagraphs } from '../../lib/publicSiteText'
import { school } from '../../content/siteContent'
import { useAsyncData } from '../../hooks/useAsyncData'
import { LoadError, Loading } from '../../components/public/PublicBits'

// One news post (published ones only; drafts and future posts aren't found).
export default function NewsPost() {
  const { id } = useParams()
  const query = useAsyncData(() => fetchNewsPost(id), `public-news-post:${id}`)
  const post = query.data

  useEffect(() => {
    if (post) document.title = `${post.title} · ${school.name}`
    return () => {
      document.title = school.name
    }
  }, [post])

  return (
    <section className="pub-section pub-article-section">
      <div className="pub-wrap pub-article-wrap">
        <Link to="/news" className="pub-text-link pub-back">
          <span aria-hidden="true">←</span> All news
        </Link>
        {query.loading ? (
          <Loading />
        ) : query.error ? (
          <LoadError />
        ) : !post ? (
          <div className="pub-empty">
            <h1>Post not found</h1>
            <p>This story may have been removed. See the latest news instead.</p>
          </div>
        ) : (
          <article className="pub-article">
            <time dateTime={post.published_at}>{formatLongDate(post.published_at)}</time>
            <h1>{post.title}</h1>
            {post.cover_image_url && <img className="pub-article-cover" src={galleryUrl(post.cover_image_url)} alt="" />}
            <div className="pub-prose">
              {toParagraphs(post.body).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
